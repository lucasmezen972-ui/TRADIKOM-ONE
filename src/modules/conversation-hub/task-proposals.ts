import { z } from "zod";
import type { DbClient } from "@/lib/db";
import { hashToken, nowIso } from "@/lib/security";
import { withTenantDbTransaction } from "@/db/tenant-context";
import { recordAuditLog } from "@/modules/audit";
import { assertTenantAccess, lockMembershipRole } from "@/modules/tenants";
import { ConversationHubError } from "./errors";
import { createConversationContactTask, createConversationContactTaskSchema, withNativeTransaction } from "./native-tasks";
import { findAccessibleConversationThreadRow, findConversationMessageRow, lockConversationThreadRow } from "./repository";

export const prepareConversationTaskProposalSchema = createConversationContactTaskSchema.omit({ teamVisibilityConfirmed: true });
export type PrepareConversationTaskProposalInput = z.input<typeof prepareConversationTaskProposalSchema>;
const decideSchema = z.object({
  proposalId: createConversationContactTaskSchema.shape.threadId,
  decision: z.enum(["approved", "rejected"]),
  teamVisibilityConfirmed: z.boolean().default(false),
}).strict().refine(p => p.decision === "rejected" || p.teamVisibilityConfirmed, "Confirmez la création et la visibilité équipe.");
export type DecideConversationTaskProposalInput = z.input<typeof decideSchema>;
const writeRoles = ["owner", "administrator", "manager", "collaborator"] as const;
type ProposalRow = {
  id: string; tenant_id: string; actor_id: string; thread_id: string; source_message_id: string;
  source_fingerprint: string; request_key_hash: string; request_fingerprint: string;
  contact_id: string; title: string; due_at: string; status: "pending" | "executed" | "rejected";
  task_id: string | null; report_message_id: string | null; created_at: string; decided_at: string | null;
};
type ListedRow = ProposalRow & { contact_name: string; contact_status: string; source_text: string | null };
export type ConversationTaskProposal = ReturnType<typeof view>;

export async function prepareConversationTaskProposal(db: DbClient, actorId: string, tenantId: string, input: PrepareConversationTaskProposalInput) {
  const parsed = prepareConversationTaskProposalSchema.parse(input);
  const dueAt = new Date(parsed.dueAt).toISOString();
  const key = hashToken(JSON.stringify([tenantId, actorId, parsed.threadId, parsed.sourceMessageId, parsed.idempotencyKey]));
  const fingerprint = hashToken(JSON.stringify([parsed.contactId, parsed.title, dueAt]));
  return withNativeTransaction(db, tenantId, actorId, async tx => {
    await lockWriter(tx, actorId, tenantId, parsed.threadId);
    const previous = await find(tx, tenantId, `task_proposal_${key}`);
    if (previous) {
      if (previous.request_fingerprint !== fingerprint) throw conflict();
      return { id: previous.id, threadId: previous.thread_id, idempotentReplay: true };
    }
    if (new Date(dueAt).getTime() <= Date.now()) throw expired();
    const source = await findConversationMessageRow(tx, tenantId, parsed.threadId, parsed.sourceMessageId);
    if (!source || source.direction !== "inbound" || source.kind !== "text") throw unavailable();
    await requireContact(tx, tenantId, parsed.contactId);
    const id = `task_proposal_${key}`;
    await tx.query(`insert into conversation_task_proposals
      (id,tenant_id,actor_id,thread_id,source_message_id,source_fingerprint,request_key_hash,
       request_fingerprint,contact_id,title,due_at,status,created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12)`,
      [id, tenantId, actorId, parsed.threadId, source.id, hashToken(source.text_content ?? ""), key,
        fingerprint, parsed.contactId, parsed.title, dueAt, nowIso()]);
    await recordAuditLog(tx, { tenantId, actorId, action: "conversation.task_proposal.prepared",
      targetType: "conversation_task_proposal", targetId: id, metadata: { requestFingerprint: fingerprint } });
    return { id, threadId: parsed.threadId, idempotentReplay: false };
  });
}

export async function decideConversationTaskProposal(db: DbClient, actorId: string, tenantId: string, input: DecideConversationTaskProposalInput) {
  const parsed = decideSchema.parse(input);
  // The initial read is tenant/thread scoped and never permits a decision itself.
  const located = await withTenantDbTransaction(db, tenantId, actorId, async tx => {
    await assertTenantAccess(tx, actorId, tenantId, [...writeRoles]);
    const row = await find(tx, tenantId, parsed.proposalId);
    if (!row || row.actor_id !== actorId || !await findAccessibleConversationThreadRow(tx, tenantId, actorId, row.thread_id)) throw unavailable();
    return { threadId: row.thread_id };
  });
  return withNativeTransaction(db, tenantId, actorId, async tx => {
    // Same lock order as the native executor: membership, thread, then proposal.
    await lockWriter(tx, actorId, tenantId, located.threadId);
    const row = await find(tx, tenantId, parsed.proposalId, true);
    if (!row || row.actor_id !== actorId || row.thread_id !== located.threadId) throw unavailable();
    const target = parsed.decision === "approved" ? "executed" : "rejected";
    if (row.status === target) return { id: row.id, threadId: row.thread_id, taskId: row.task_id, reportMessageId: row.report_message_id, status: row.status, idempotentReplay: true };
    if (row.status !== "pending") throw conflict();
    let taskId: string | null = null, reportMessageId: string | null = null;
    if (parsed.decision === "approved") {
      if (new Date(row.due_at).getTime() <= Date.now()) throw expired();
      const source = (await tx.query<{ text_content: string | null; direction: string; kind: string }>(
        "select text_content,direction,kind from conversation_messages where tenant_id=$1 and thread_id=$2 and id=$3 for share",
        [tenantId, row.thread_id, row.source_message_id])).rows[0];
      if (!source || source.direction !== "inbound" || source.kind !== "text" || hashToken(source.text_content ?? "") !== row.source_fingerprint) throw conflict();
      await requireContact(tx, tenantId, row.contact_id);
      const result = await createConversationContactTask(tx, actorId, tenantId, {
        threadId: row.thread_id, sourceMessageId: row.source_message_id, contactId: row.contact_id,
        title: row.title, dueAt: row.due_at, idempotencyKey: row.id, teamVisibilityConfirmed: true,
      });
      taskId = result.taskId; reportMessageId = result.reportMessageId;
    }
    await tx.query(`update conversation_task_proposals set status=$3,task_id=$4,report_message_id=$5,decided_at=$6
      where tenant_id=$1 and id=$2`, [tenantId, row.id, target, taskId, reportMessageId, nowIso()]);
    await recordAuditLog(tx, { tenantId, actorId, action: `conversation.task_proposal.${target}`,
      targetType: "conversation_task_proposal", targetId: row.id,
      metadata: { requestFingerprint: row.request_fingerprint, ...(taskId ? { taskId, reportMessageId } : {}) } });
    return { id: row.id, threadId: row.thread_id, taskId, reportMessageId, status: target, idempotentReplay: false };
  });
}

export async function listConversationTaskProposals(db: DbClient, actorId: string, tenantId: string, threadId: string) {
  return withTenantDbTransaction(db, tenantId, actorId, async tx => {
    const role = await assertTenantAccess(tx, actorId, tenantId);
    const thread = await findAccessibleConversationThreadRow(tx, tenantId, actorId, threadId);
    if (!thread) throw unavailable();
    const rows = await tx.query<ListedRow>(`select p.*,c.name as contact_name,c.status as contact_status,m.text_content as source_text
      from conversation_task_proposals p join contacts c on c.tenant_id=p.tenant_id and c.id=p.contact_id
      join conversation_messages m on m.tenant_id=p.tenant_id and m.thread_id=p.thread_id and m.id=p.source_message_id
      where p.tenant_id=$1 and p.thread_id=$2 order by p.created_at desc,p.id desc limit 50`, [tenantId, threadId]);
    const writable = writeRoles.some(r => r === role) && thread.status !== "archived";
    return rows.rows.map(row => view(row, actorId, writable));
  });
}

function view(row: ListedRow, actorId: string, writable: boolean) {
  const expired = new Date(row.due_at).getTime() <= Date.now();
  const contextChanged = row.contact_status === "archived" || hashToken(row.source_text ?? "") !== row.source_fingerprint;
  const canDecide = writable && row.actor_id === actorId && row.status === "pending";
  return { id: row.id, threadId: row.thread_id, sourceMessageId: row.source_message_id,
    contactId: row.contact_id, contactName: row.contact_name, title: row.title, dueAt: row.due_at,
    status: row.status, taskId: row.task_id, reportMessageId: row.report_message_id,
    canConfirm: canDecide && !expired && !contextChanged, canReject: canDecide, expired, contextChanged };
}
async function lockWriter(tx: DbClient, actorId: string, tenantId: string, threadId: string) {
  await assertTenantAccess(tx, actorId, tenantId, [...writeRoles]);
  const role = await lockMembershipRole(tx, actorId, tenantId);
  const actor = await tx.query("select id from users where id=$1 and deleted_at is null for share", [actorId]);
  if (!role || !writeRoles.some(r => r === role) || !actor.rows[0]) throw unavailable();
  const thread = await lockConversationThreadRow(tx, tenantId, threadId);
  if (!thread || thread.status === "archived" || !await findAccessibleConversationThreadRow(tx, tenantId, actorId, threadId)) throw unavailable();
}
async function requireContact(tx: DbClient, tenantId: string, contactId: string) {
  if (!(await tx.query("select id from contacts where tenant_id=$1 and id=$2 and status<>'archived' for share", [tenantId, contactId])).rows[0]) throw unavailable();
}
async function find(tx: DbClient, tenantId: string, id: string, lock = false) {
  return (await tx.query<ProposalRow>("select * from conversation_task_proposals where tenant_id=$1 and id=$2" + (lock ? " for update" : ""), [tenantId, id])).rows[0];
}
function unavailable() { return new ConversationHubError("conversation_access_denied", "Cette proposition n’est pas accessible ou votre rôle ne permet pas cette action."); }
function conflict() { return new ConversationHubError("conversation_idempotency_conflict", "La proposition a changé ou a déjà été décidée. Rechargez le fil avant de continuer."); }
function expired() { return new ConversationHubError("conversation_idempotency_conflict", "L’échéance est dépassée. Préparez une nouvelle proposition."); }
