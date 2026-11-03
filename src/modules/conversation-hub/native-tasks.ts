import type { PGlite } from "@electric-sql/pglite";
import { z } from "zod";
import type { DbClient } from "@/lib/db";
import { hashToken, nowIso } from "@/lib/security";
import { withTenantDbTransaction, withTenantSystemDbTransaction } from "@/db/tenant-context";
import { recordAuditLog } from "@/modules/audit";
import { createContactTask } from "@/modules/crm/service";
import { assertTenantAccess, lockMembershipRole } from "@/modules/tenants";
import { ConversationHubError } from "./errors";
import { findAccessibleConversationThreadRow, findConversationMessageRow, lockConversationThreadRow } from "./repository";
import { ingestSystemConversationMessage } from "./service";

const identifier = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const createConversationContactTaskSchema = z.object({
  threadId: identifier, sourceMessageId: identifier, contactId: identifier,
  title: z.string().trim().min(3).max(200), dueAt: z.string().datetime({ offset: true }),
  idempotencyKey: identifier.min(8), teamVisibilityConfirmed: z.literal(true),
}).strict();
export type CreateConversationContactTaskInput = z.input<typeof createConversationContactTaskSchema>;
const proofSchema = z.object({ taskId: identifier, reportMessageId: identifier, requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const writeRoles = ["owner", "administrator", "manager", "collaborator"] as const;

export async function listConversationTaskContacts(db: DbClient, actorId: string, tenantId: string, threadId: string) {
  return withTenantDbTransaction(db, tenantId, actorId, async (transaction) => {
    await assertTenantAccess(transaction, actorId, tenantId);
    if (!await findAccessibleConversationThreadRow(transaction, tenantId, actorId, threadId)) throw unavailable();
    return (await transaction.query<{ id: string; name: string }>(
      "select id, name from contacts where tenant_id = $1 and status <> 'archived' order by name, id limit 100", [tenantId])).rows;
  });
}

export async function createConversationContactTask(
  db: DbClient, actorId: string, tenantId: string, input: CreateConversationContactTaskInput,
) {
  const parsed = createConversationContactTaskSchema.parse(input);
  const dueAt = new Date(parsed.dueAt).toISOString();
  const requestKey = hashToken(JSON.stringify([tenantId, actorId, parsed.threadId, parsed.sourceMessageId, parsed.idempotencyKey]));
  const requestFingerprint = hashToken(JSON.stringify([parsed.title, parsed.contactId, dueAt, true]));
  return withNativeTransaction(db, tenantId, actorId, async (transaction) => {
    await assertTenantAccess(transaction, actorId, tenantId, [...writeRoles]);
    const role = await lockMembershipRole(transaction, actorId, tenantId);
    const activeActor = await transaction.query("select id from users where id = $1 and deleted_at is null for share", [actorId]);
    if (!role || !writeRoles.some((allowed) => allowed === role) || !activeActor.rows[0]) throw unavailable();
    const thread = await lockConversationThreadRow(transaction, tenantId, parsed.threadId);
    if (!thread || thread.status === "archived" || !await findAccessibleConversationThreadRow(transaction, tenantId, actorId, thread.id)) throw unavailable();
    const source = await findConversationMessageRow(transaction, tenantId, thread.id, parsed.sourceMessageId);
    if (!source || source.direction !== "inbound" || source.kind !== "text") throw unavailable();
    const previous = await transaction.query<{ safe_metadata: string }>(`select safe_metadata from audit_logs
      where tenant_id = $1 and target_type = 'conversation_native_task_request' and target_id = $2
        and action = 'conversation.native_task.created' limit 2`, [tenantId, requestKey]);
    if (previous.rows.length) {
      let proof: z.infer<typeof proofSchema>;
      try {
        if (previous.rows.length !== 1) throw new Error("duplicate_proof");
        proof = proofSchema.parse(JSON.parse(previous.rows[0].safe_metadata));
      } catch { throw conflict(); }
      if (proof.requestFingerprint !== requestFingerprint) throw conflict();
      return { taskId: proof.taskId, reportMessageId: proof.reportMessageId, threadId: thread.id, idempotentReplay: true };
    }
    const taskId = await createContactTask(transaction, actorId, tenantId, parsed.contactId, {
      title: parsed.title, dueAt, assignedUserId: actorId,
    });
    const timestamp = nowIso();
    const tenantDigest = hashToken(tenantId).slice(0, 32);
    const report = await ingestSystemConversationMessage(transaction, "system_native_tasks", {
      tenantId, threadId: thread.id,
      channelIdentity: { id: `identity_native_task_${tenantDigest}`, tenantId,
        participantId: `participant_native_task_${tenantDigest}`, channelKind: "web", adapterKey: "native-actions",
        externalSubjectId: `native-task:${tenantDigest}`, displayName: "Actions TRADIKOM", role: "system", state: "active",
        createdAt: timestamp, updatedAt: timestamp },
      externalMessageId: `native-task:${requestKey}`, idempotencyKey: `native-task:report:${requestKey}`,
      correlationId: `native-task:${requestKey.slice(0, 48)}`, causationId: source.id,
      routeTrace: [], occurredAt: timestamp, attachments: [],
      text: `Tâche créée dans le CRM : ${parsed.title}\nElle est attribuée à votre compte et visible par votre équipe. Aucun message externe n’a été envoyé.`,
    });
    await recordAuditLog(transaction, { tenantId, actorId, action: "conversation.native_task.created",
      targetType: "conversation_native_task_request", targetId: requestKey,
      metadata: { taskId, reportMessageId: report.messageId, requestFingerprint } });
    return { taskId, reportMessageId: report.messageId, threadId: thread.id, idempotentReplay: false };
  });
}

async function withNativeTransaction<T>(db: DbClient, tenantId: string, actorId: string, callback: (transaction: DbClient) => Promise<T>): Promise<T> {
  const client = db as DbClient & { __transaction?: boolean; transaction?: PGlite["transaction"] };
  if (!client.__transaction && client.transaction) {
    return client.transaction((transaction) => callback({ __transaction: true,
      query: (sql: string, params?: unknown[]) => transaction.query(sql, params) } as DbClient));
  }
  return withTenantSystemDbTransaction(db, tenantId, actorId, callback);
}

function unavailable() { return new ConversationHubError("conversation_access_denied", "Cette action n'est pas autorisée pour ce fil."); }
function conflict() { return new ConversationHubError("conversation_idempotency_conflict", "Cette demande a déjà été utilisée avec d'autres paramètres."); }
