import type { DbClient } from "@/lib/db";

export type ConversationActionPlanRow = {
  id: string;
  tenant_id: string;
  thread_id: string;
  source_message_id: string;
  schema_version: number;
  generation_source: "deterministic_mock" | "model";
  model_reference: string | null;
  approval_status:
    | "draft"
    | "awaiting_approval"
    | "approved"
    | "rejected"
    | "executed";
  intent: string;
  business_goal: string;
  confidence: number;
  risk_summary: string;
  estimated_cost_minor: number;
  estimated_cost_currency: string;
  plan_json: string;
  plan_fingerprint: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
};

export type ConversationActionPlanStepRow = {
  tenant_id: string;
  plan_id: string;
  position: number;
  step_id: string;
  capability: string;
  mode: "read" | "write" | "execute" | "subscribe";
  execution_environment: "mock";
  risk: "low" | "medium" | "high" | "critical";
  requires_approval: number;
  reversible: "true" | "false" | "compensation_only";
  input_json: string;
  evidence_required_json: string;
  idempotency_key: string;
  status:
    | "planned"
    | "approved"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled";
};

type ApprovalRow = {
  id: string;
  tenant_id: string;
  requested_by: string;
  policy: string;
  status: string;
  target_type: string;
  target_id: string;
  created_at: string;
};

export async function findActionPlanByFingerprint(
  db: DbClient,
  tenantId: string,
  sourceMessageId: string,
  fingerprint: string,
) {
  const result = await db.query<ConversationActionPlanRow>(
    `select *
     from conversation_action_plans
     where tenant_id = $1 and source_message_id = $2 and plan_fingerprint = $3`,
    [tenantId, sourceMessageId, fingerprint],
  );
  return result.rows[0] ?? null;
}

export async function findActionPlanRow(
  db: DbClient,
  tenantId: string,
  planId: string,
) {
  const result = await db.query<ConversationActionPlanRow>(
    `select * from conversation_action_plans where tenant_id = $1 and id = $2`,
    [tenantId, planId],
  );
  return result.rows[0] ?? null;
}

export async function insertActionPlan(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    threadId: string;
    sourceMessageId: string;
    generationSource: ConversationActionPlanRow["generation_source"];
    modelReference: string | null;
    approvalStatus: ConversationActionPlanRow["approval_status"];
    intent: string;
    businessGoal: string;
    confidence: number;
    riskSummary: string;
    estimatedCostMinor: number;
    estimatedCostCurrency: string;
    planJson: string;
    planFingerprint: string;
    createdBy: string;
    createdAt: string;
    decidedBy: string | null;
    decidedAt: string | null;
    decisionReason: string | null;
  },
) {
  const result = await db.query<ConversationActionPlanRow>(
    `insert into conversation_action_plans (
       id, tenant_id, thread_id, source_message_id, schema_version,
       generation_source, model_reference, approval_status, intent,
       business_goal, confidence, risk_summary, estimated_cost_minor,
       estimated_cost_currency, plan_json, plan_fingerprint, created_by,
       created_at, updated_at, decided_by, decided_at, decision_reason
     ) values (
       $1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17, $17, $18, $19, $20
     )
     on conflict (tenant_id, source_message_id, plan_fingerprint) do nothing
     returning *`,
    [
      input.id,
      input.tenantId,
      input.threadId,
      input.sourceMessageId,
      input.generationSource,
      input.modelReference,
      input.approvalStatus,
      input.intent,
      input.businessGoal,
      input.confidence,
      input.riskSummary,
      input.estimatedCostMinor,
      input.estimatedCostCurrency,
      input.planJson,
      input.planFingerprint,
      input.createdBy,
      input.createdAt,
      input.decidedBy,
      input.decidedAt,
      input.decisionReason,
    ],
  );
  return result.rows[0] ?? null;
}

export async function insertActionPlanStep(
  db: DbClient,
  input: {
    tenantId: string;
    planId: string;
    position: number;
    stepId: string;
    capability: string;
    mode: ConversationActionPlanStepRow["mode"];
    risk: ConversationActionPlanStepRow["risk"];
    requiresApproval: boolean;
    reversible: ConversationActionPlanStepRow["reversible"];
    inputJson: string;
    evidenceRequiredJson: string;
    idempotencyKey: string;
  },
) {
  await db.query(
    `insert into conversation_action_plan_steps (
       tenant_id, plan_id, position, step_id, capability, mode,
       execution_environment, risk, requires_approval, reversible, input_json,
       evidence_required_json, idempotency_key, status
     ) values ($1, $2, $3, $4, $5, $6, 'mock', $7, $8, $9, $10, $11, $12,
       'planned')`,
    [
      input.tenantId,
      input.planId,
      input.position,
      input.stepId,
      input.capability,
      input.mode,
      input.risk,
      input.requiresApproval ? 1 : 0,
      input.reversible,
      input.inputJson,
      input.evidenceRequiredJson,
      input.idempotencyKey,
    ],
  );
}

export async function listActionPlanStepRows(
  db: DbClient,
  tenantId: string,
  planId: string,
) {
  const result = await db.query<ConversationActionPlanStepRow>(
    `select *
     from conversation_action_plan_steps
     where tenant_id = $1 and plan_id = $2
     order by position asc`,
    [tenantId, planId],
  );
  return result.rows;
}

export async function insertActionPlanApproval(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    requestedBy: string;
    planId: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into approvals (
       id, tenant_id, requested_by, policy, status, target_type, target_id,
       created_at
     ) values ($1, $2, $3, 'single', 'pending', 'conversation_action_plan', $4,
       $5)`,
    [
      input.id,
      input.tenantId,
      input.requestedBy,
      input.planId,
      input.createdAt,
    ],
  );
}

export async function findActionPlanApproval(
  db: DbClient,
  tenantId: string,
  planId: string,
) {
  const result = await db.query<ApprovalRow>(
    `select *
     from approvals
     where tenant_id = $1 and target_type = 'conversation_action_plan'
       and target_id = $2`,
    [tenantId, planId],
  );
  return result.rows[0] ?? null;
}

export async function updateActionPlanApprovalStatus(
  db: DbClient,
  tenantId: string,
  approvalId: string,
  status: "approved" | "rejected",
) {
  const result = await db.query<ApprovalRow>(
    `update approvals
     set status = $1
     where tenant_id = $2 and id = $3 and status = 'pending'
     returning *`,
    [status, tenantId, approvalId],
  );
  return result.rows[0] ?? null;
}

export async function decideActionPlanRow(
  db: DbClient,
  input: {
    tenantId: string;
    planId: string;
    status: "approved" | "rejected";
    decidedBy: string;
    decidedAt: string;
    reason: string;
  },
) {
  const result = await db.query<ConversationActionPlanRow>(
    `update conversation_action_plans
     set approval_status = $1, decided_by = $2, decided_at = $3,
       decision_reason = $4, updated_at = $3
     where tenant_id = $5 and id = $6 and approval_status = 'awaiting_approval'
     returning *`,
    [
      input.status,
      input.decidedBy,
      input.decidedAt,
      input.reason,
      input.tenantId,
      input.planId,
    ],
  );
  return result.rows[0] ?? null;
}

export async function updateActionPlanStepStatuses(
  db: DbClient,
  tenantId: string,
  planId: string,
  status: "approved" | "cancelled",
) {
  await db.query(
    `update conversation_action_plan_steps
     set status = $1
     where tenant_id = $2 and plan_id = $3 and status = 'planned'`,
    [status, tenantId, planId],
  );
}
