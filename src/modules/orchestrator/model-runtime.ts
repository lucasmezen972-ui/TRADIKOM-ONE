import type { PGlite } from "@electric-sql/pglite";
import { z } from "zod";
import type { DbClient } from "@/lib/db";
import { hashToken, nowIso } from "@/lib/security";
import { withTenantSystemDbTransaction } from "@/db/tenant-context";
import { assertTenantAccess, lockMembershipRole } from "@/modules/tenants";
import { recordAuditLog } from "@/modules/audit";
import { findAccessibleConversationThreadRow, findConversationMessageRow, lockConversationThreadRow } from "@/modules/conversation-hub/repository";
import { createConfiguredConversationModelGenerator, ConversationModelGenerationError,
  type ConversationModelAuthorization, type ConversationModelOutcome, type OpenAiPlanTransport } from "./openai-generator";
import { actionPlanSchema, generatedActionPlanEnvelopeSchema } from "./schemas";
import { createConversationActionPlan } from "./service";
import type { ActionPlanGenerator, GeneratedActionPlan } from "./generator";

// Standard API prices checked 2026-11-03. No tool calls, regional endpoint or priority tier.
// https://developers.openai.com/api/docs/models/gpt-5.4-mini
export const conversationModelName = "gpt-5.4-mini-2026-03-17";
export const conversationModelMaximumCostMicroUsd = 25_000;
const maximumInputBytes = 20_000;
const maximumOutputTokens = 1_024;
const identifier = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const writeRoles = ["owner", "administrator", "manager", "collaborator"] as const;
export const createModelPlanInputSchema = z.object({
  threadId: identifier, sourceMessageId: identifier, idempotencyKey: identifier.min(8),
  dataTransferApproved: z.literal(true), externalContextApproved: z.boolean().default(false),
  maximumCostMicroUsd: z.literal(conversationModelMaximumCostMicroUsd),
}).strict();
export type CreateModelPlanInput = z.input<typeof createModelPlanInputSchema>;

type Environment = Record<string, string | undefined>;
type RequestRow = { id: string; context_fingerprint: string; status: "reserved" | "succeeded" | "failed"; generation_snapshot: string | null };

export function getConversationModelReadiness(environment: Environment = process.env) {
  const { globalBudget, tenantBudget } = configuredBudgets(environment);
  const state = environment.FEATURE_CONVERSATION_MODEL !== "true" ? "disabled"
    : (environment.OPENAI_MODEL && environment.OPENAI_MODEL !== conversationModelName) ? "unsupported_model"
    : !environment.OPENAI_API_KEY?.trim() ? "missing_key"
    : Math.min(globalBudget, tenantBudget) < conversationModelMaximumCostMicroUsd ? "missing_budget" : "ready";
  return { state, model: conversationModelName, maximumCostMicroUsd: conversationModelMaximumCostMicroUsd } as const;
}

export async function createConversationModelPlan(db: DbClient, actorId: string, tenantId: string,
  input: CreateModelPlanInput, dependencies: { environment?: Environment; transport?: OpenAiPlanTransport } = {}) {
  const parsed = createModelPlanInputSchema.parse(input);
  const environment = dependencies.environment ?? process.env;
  if (getConversationModelReadiness(environment).state !== "ready") throw new ConversationModelGenerationError("model_not_configured");
  const { globalBudget, tenantBudget } = configuredBudgets(environment);
  const requestKeyHash = hashToken(JSON.stringify([tenantId, actorId, parsed.threadId, parsed.sourceMessageId, parsed.idempotencyKey]));
  const reservationId = `model_request_${requestKeyHash}`;
  const generator: ActionPlanGenerator = {
    async generate(context) {
      const contextFingerprint = hashToken(JSON.stringify({ context,
        externalContextApproved: parsed.externalContextApproved, maximumCostMicroUsd: parsed.maximumCostMicroUsd }));
      const previous = await withModelTransaction(db, tenantId, actorId, async (transaction) => {
        await authorizeActor(transaction, actorId, tenantId, parsed);
        return findRequest(transaction, reservationId);
      });
      if (previous) {
        if (previous.context_fingerprint !== contextFingerprint || previous.status !== "succeeded" || !previous.generation_snapshot) {
          throw new ConversationModelGenerationError("model_not_authorized");
        }
        return parseModelSnapshot(previous.generation_snapshot);
      }
      const model = createConfiguredConversationModelGenerator({ enabled: true, apiKey: environment.OPENAI_API_KEY,
        model: conversationModelName, maximumOutputTokens }, {
        transport: dependencies.transport,
        authorizeAndReserve: async (request) => {
          if (request.tenantId !== tenantId || request.threadId !== parsed.threadId || request.sourceMessageId !== parsed.sourceMessageId
            || request.model !== conversationModelName || request.maximumInputBytes > maximumInputBytes
            || request.maximumOutputTokens > maximumOutputTokens || (request.includesExternalContext && !parsed.externalContextApproved)) return null;
          return withModelTransaction(db, tenantId, actorId, async (transaction) => {
            await authorizeActor(transaction, actorId, tenantId, parsed);
            if ((transaction as { __runtime?: string }).__runtime === "postgres") {
              await transaction.query("select pg_advisory_xact_lock(hashtextextended('tradikom_conversation_model_budget', 0))");
            }
            if (await findRequest(transaction, reservationId)) return null;
            const budget = (await transaction.query<{ total: number | string; tenant_total: number | string }>(`
              select coalesce(sum(reserved_cost_micro_usd), 0) as total,
                coalesce(sum(reserved_cost_micro_usd) filter (where tenant_id = $1), 0) as tenant_total
              from conversation_model_budget_charges`, [tenantId])).rows[0];
            if (Number(budget.total) + conversationModelMaximumCostMicroUsd > globalBudget
              || Number(budget.tenant_total) + conversationModelMaximumCostMicroUsd > tenantBudget) return null;
            const timestamp = nowIso();
            const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString();
            await transaction.query(`insert into conversation_model_budget_charges (id, tenant_id, reserved_cost_micro_usd, created_at)
              values ($1, $2, $3, $4)`, [reservationId, tenantId, conversationModelMaximumCostMicroUsd, timestamp]);
            await transaction.query(`insert into conversation_model_requests
              (id, tenant_id, actor_id, thread_id, source_message_id, request_key_hash, context_fingerprint, model,
               external_context_approved, consented_at, expires_at, status)
              values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'reserved')`,
            [reservationId, tenantId, actorId, parsed.threadId, parsed.sourceMessageId, requestKeyHash,
              contextFingerprint, conversationModelName, parsed.externalContextApproved, timestamp, expiresAt]);
            await recordAuditLog(transaction, { tenantId, actorId, action: "conversation.model.reserved",
              targetType: "conversation_model_request", targetId: reservationId,
              metadata: { model: conversationModelName, maximumCostMicroUsd: conversationModelMaximumCostMicroUsd,
                externalContextApproved: parsed.externalContextApproved } });
            return { reservationId, tenantId, threadId: parsed.threadId, sourceMessageId: parsed.sourceMessageId,
              model: conversationModelName, dataTransferApproved: true as const,
              externalContextApproved: parsed.externalContextApproved, maximumInputBytes: request.maximumInputBytes,
              maximumOutputTokens, expiresAt };
          });
        },
        recordOutcome: (authorization, outcome) => recordModelOutcome(db, actorId, authorization, outcome),
      });
      const generated = parseModelSnapshot(await model.generate(context));
      await withModelTransaction(db, tenantId, actorId, async (transaction) => {
        const result = await transaction.query(`update conversation_model_requests set generation_snapshot = $4
          where id = $1 and tenant_id = $2 and actor_id = $3 and status = 'succeeded' and generation_snapshot is null returning id`,
        [reservationId, tenantId, actorId, JSON.stringify(generated)]);
        if (result.rows.length !== 1) throw new ConversationModelGenerationError("model_audit_unavailable");
      });
      return generated;
    },
  };
  return createConversationActionPlan(db, actorId, { tenantId, threadId: parsed.threadId, sourceMessageId: parsed.sourceMessageId }, { generator });
}

async function recordModelOutcome(db: DbClient, actorId: string, authorization: ConversationModelAuthorization, outcome: ConversationModelOutcome) {
  await withModelTransaction(db, authorization.tenantId, actorId, async (transaction) => {
    const result = await transaction.query(`update conversation_model_requests set status = $4, outcome_reason = $5,
      input_tokens = $6, output_tokens = $7, completed_at = $8
      where id = $1 and tenant_id = $2 and actor_id = $3 and status = 'reserved' returning id`,
    [authorization.reservationId, authorization.tenantId, actorId, outcome.status, outcome.reason,
      safeTokenCount(outcome.inputTokens), safeTokenCount(outcome.outputTokens), nowIso()]);
    if (result.rows.length !== 1) throw new ConversationModelGenerationError("model_audit_unavailable");
    await recordAuditLog(transaction, { tenantId: authorization.tenantId, actorId,
      action: "conversation.model.completed", targetType: "conversation_model_request", targetId: authorization.reservationId,
      metadata: { status: outcome.status, reason: outcome.reason } });
  });
}

async function authorizeActor(db: DbClient, actorId: string, tenantId: string, input: { threadId: string; sourceMessageId: string }) {
  await assertTenantAccess(db, actorId, tenantId, [...writeRoles]);
  const role = await lockMembershipRole(db, actorId, tenantId);
  const actor = await db.query("select id from users where id = $1 and deleted_at is null for share", [actorId]);
  const thread = await lockConversationThreadRow(db, tenantId, input.threadId);
  if (!role || !writeRoles.some((allowed) => role === allowed) || !actor.rows[0] || !thread || thread.status === "archived"
    || !await findAccessibleConversationThreadRow(db, tenantId, actorId, input.threadId)) throw new ConversationModelGenerationError("model_not_authorized");
  const source = await findConversationMessageRow(db, tenantId, input.threadId, input.sourceMessageId);
  if (!source || source.direction !== "inbound" || source.kind !== "text") throw new ConversationModelGenerationError("model_not_authorized");
}

async function findRequest(db: DbClient, id: string) {
  return (await db.query<RequestRow>("select id, context_fingerprint, status, generation_snapshot from conversation_model_requests where id = $1", [id])).rows[0] ?? null;
}
function parseModelSnapshot(raw: unknown): GeneratedActionPlan {
  try {
    const envelope = generatedActionPlanEnvelopeSchema.parse(typeof raw === "string" ? JSON.parse(raw) : raw);
    if (envelope.generationSource !== "model") throw new Error("invalid_model_source");
    return { generationSource: "model", modelReference: z.string().trim().min(1).max(100).parse(envelope.modelReference),
      plan: actionPlanSchema.parse(envelope.plan) };
  } catch { throw new ConversationModelGenerationError("model_output_invalid"); }
}
function integerBudget(raw: string | undefined) { const n = Number(raw); return /^\d+$/.test(raw ?? "") && Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000 ? n : 0; }
function configuredBudgets(environment: Environment) {
  const globalBudget = integerBudget(environment.CONVERSATION_MODEL_BUDGET_MICRO_USD);
  // Only an omitted tenant cap gets the default. Explicit zero or malformed
  // configuration must never silently authorize a nonzero allowance.
  const rawTenantBudget = environment.CONVERSATION_MODEL_TENANT_BUDGET_MICRO_USD;
  const tenantBudget = Math.min(globalBudget, rawTenantBudget === undefined ? 100_000 : integerBudget(rawTenantBudget));
  return { globalBudget, tenantBudget };
}
function safeTokenCount(value: number | null) { return value !== null && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : null; }
async function withModelTransaction<T>(db: DbClient, tenantId: string, actorId: string, callback: (transaction: DbClient) => Promise<T>): Promise<T> {
  const client = db as DbClient & { __transaction?: boolean; transaction?: PGlite["transaction"] };
  if (!client.__transaction && client.transaction) return client.transaction((transaction) => callback({ __transaction: true,
    query: (sql: string, params?: unknown[]) => transaction.query(sql, params) } as DbClient));
  return withTenantSystemDbTransaction(db, tenantId, actorId, callback);
}
