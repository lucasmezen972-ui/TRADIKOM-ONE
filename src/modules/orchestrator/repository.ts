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
  supersedes_plan_id: string | null;
  revision_request_fingerprint: string | null;
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

export type ConversationActionPlanPolicyReceiptRow = {
  id: string;
  tenant_id: string;
  plan_id: string;
  plan_fingerprint: string;
  approval_id: string | null;
  approval_mode: "none" | "single";
  approval_status: "not_required" | "approved";
  approved_by_user_id: string;
  payload_json: string;
  receipt_fingerprint: string;
  created_at: string;
};

export type ConversationActionPlanDelegationRow = {
  id: string;
  tenant_id: string;
  plan_id: string;
  plan_fingerprint: string;
  approval_id: string;
  approval_target_type: "conversation_action_plan";
  version: number;
  expected_previous_version: number;
  delegated_by_user_id: string;
  delegated_to_user_id: string;
  delegated_to_role: "owner" | "administrator" | "manager";
  idempotency_key_hash: string;
  request_fingerprint: string;
  created_at: string;
};

export type ConversationActionPlanDelegationViewRow =
  ConversationActionPlanDelegationRow & {
    delegated_to_name: string;
    delegated_to_email: string;
  };

export type ConversationActionPlanDelegationTargetRow = {
  user_id: string;
  name: string;
  email: string;
  role: "owner" | "administrator" | "manager";
};

const conversationActionPlanDelegationProjection = `
  delegation.id, delegation.tenant_id, delegation.plan_id,
  delegation.plan_fingerprint, delegation.approval_id,
  delegation.approval_target_type, delegation.version,
  delegation.expected_previous_version, delegation.delegated_by_user_id,
  delegation.delegated_to_user_id, delegation.delegated_to_role,
  delegation.idempotency_key_hash, delegation.request_fingerprint,
  delegation.created_at, delegated_user.name as delegated_to_name,
  delegated_user.email as delegated_to_email
`;

export async function findConversationActionPlanDelegationByIdempotencyHash(
  db: DbClient,
  tenantId: string,
  idempotencyKeyHash: string,
) {
  const result = await db.query<ConversationActionPlanDelegationViewRow>(
    `select ${conversationActionPlanDelegationProjection}
     from conversation_action_plan_delegations delegation
     join users delegated_user on delegated_user.id = delegation.delegated_to_user_id
     where delegation.tenant_id = $1
       and delegation.idempotency_key_hash = $2`,
    [tenantId, idempotencyKeyHash],
  );
  return result.rows[0] ?? null;
}

export async function findLatestConversationActionPlanDelegation(
  db: DbClient,
  tenantId: string,
  planId: string,
) {
  const result = await db.query<ConversationActionPlanDelegationViewRow>(
    `select ${conversationActionPlanDelegationProjection}
     from conversation_action_plan_delegations delegation
     join users delegated_user on delegated_user.id = delegation.delegated_to_user_id
     where delegation.tenant_id = $1 and delegation.plan_id = $2
     order by delegation.version desc
     limit 1`,
    [tenantId, planId],
  );
  return result.rows[0] ?? null;
}

export async function insertConversationActionPlanDelegation(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    planId: string;
    planFingerprint: string;
    approvalId: string;
    version: number;
    expectedPreviousVersion: number;
    delegatedByUserId: string;
    delegatedToUserId: string;
    delegatedToRole: ConversationActionPlanDelegationRow["delegated_to_role"];
    idempotencyKeyHash: string;
    requestFingerprint: string;
    createdAt: string;
  },
) {
  const result = await db.query<ConversationActionPlanDelegationRow>(
    `insert into conversation_action_plan_delegations (
       id, tenant_id, plan_id, plan_fingerprint, approval_id,
       approval_target_type, version, expected_previous_version,
       delegated_by_user_id, delegated_to_user_id, delegated_to_role,
       idempotency_key_hash, request_fingerprint, created_at
     ) values (
       $1, $2, $3, $4, $5, 'conversation_action_plan', $6, $7, $8, $9,
       $10, $11, $12, $13
     )
     on conflict (tenant_id, idempotency_key_hash) do nothing
     returning *`,
    [
      input.id,
      input.tenantId,
      input.planId,
      input.planFingerprint,
      input.approvalId,
      input.version,
      input.expectedPreviousVersion,
      input.delegatedByUserId,
      input.delegatedToUserId,
      input.delegatedToRole,
      input.idempotencyKeyHash,
      input.requestFingerprint,
      input.createdAt,
    ],
  );
  return result.rows[0] ?? null;
}

export async function listConversationActionPlanDelegationTargetRows(
  db: DbClient,
  tenantId: string,
  planId: string,
) {
  const result = await db.query<ConversationActionPlanDelegationTargetRow>(
    `select membership.user_id, delegated_user.name, delegated_user.email,
       membership.role
     from conversation_action_plans plan
     join conversation_threads thread
       on thread.tenant_id = plan.tenant_id and thread.id = plan.thread_id
     join memberships membership on membership.tenant_id = plan.tenant_id
     join users delegated_user on delegated_user.id = membership.user_id
     where plan.tenant_id = $1 and plan.id = $2
       and plan.approval_status = 'awaiting_approval'
       and membership.role in ('owner', 'administrator', 'manager')
       and delegated_user.deleted_at is null
       and (
         thread.visibility_scope = 'tenant'
         or exists (
           select 1 from conversation_thread_access_grants access_grant
           where access_grant.tenant_id = thread.tenant_id
             and access_grant.thread_id = thread.id
             and access_grant.user_id = membership.user_id
             and access_grant.scope = thread.visibility_scope
         )
       )
     order by
       case membership.role
         when 'owner' then 0
         when 'administrator' then 1
         else 2
       end,
       delegated_user.name asc,
       delegated_user.id asc`,
    [tenantId, planId],
  );
  return result.rows;
}

export async function insertConversationActionPlanPolicyReceipt(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    planId: string;
    planFingerprint: string;
    approvalId: string | null;
    approvalMode: ConversationActionPlanPolicyReceiptRow["approval_mode"];
    approvedByUserId: string;
    payloadJson: string;
    receiptFingerprint: string;
    createdAt: string;
  },
) {
  const result = await db.query<ConversationActionPlanPolicyReceiptRow>(
    `insert into conversation_action_plan_policy_receipts (
       id, tenant_id, plan_id, plan_fingerprint, approval_id, approval_mode,
       approval_status, approved_by_user_id, payload_json, receipt_fingerprint,
       created_at
     ) values (
       $1, $2, $3, $4, $5, $6, $8::jsonb #>> '{approval,status}', $7,
       $8::jsonb, $9, $10
     )
     on conflict (tenant_id, plan_id) do nothing
     returning id::text as id, tenant_id, plan_id, plan_fingerprint,
       approval_id, approval_mode, approval_status, approved_by_user_id,
       payload_json::text as payload_json, receipt_fingerprint, created_at`,
    [
      input.id,
      input.tenantId,
      input.planId,
      input.planFingerprint,
      input.approvalId,
      input.approvalMode,
      input.approvedByUserId,
      input.payloadJson,
      input.receiptFingerprint,
      input.createdAt,
    ],
  );
  return result.rows[0] ?? null;
}

export async function findConversationActionPlanPolicyReceiptByPlan(
  db: DbClient,
  tenantId: string,
  planId: string,
) {
  const result = await db.query<ConversationActionPlanPolicyReceiptRow>(
    `select id::text as id, tenant_id, plan_id, plan_fingerprint,
       approval_id, approval_mode, approval_status, approved_by_user_id,
       payload_json::text as payload_json, receipt_fingerprint, created_at
     from conversation_action_plan_policy_receipts
     where tenant_id = $1 and plan_id = $2`,
    [tenantId, planId],
  );
  return result.rows[0] ?? null;
}

export async function lockConversationActionPlanPolicyReceiptByPlan(
  db: DbClient,
  tenantId: string,
  planId: string,
) {
  const result = await db.query<ConversationActionPlanPolicyReceiptRow>(
    `select id::text as id, tenant_id, plan_id, plan_fingerprint,
       approval_id, approval_mode, approval_status, approved_by_user_id,
       payload_json::text as payload_json, receipt_fingerprint, created_at
     from conversation_action_plan_policy_receipts
     where tenant_id = $1 and plan_id = $2
     for update`,
    [tenantId, planId],
  );
  return result.rows[0] ?? null;
}

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

export async function lockActionPlanRow(
  db: DbClient,
  tenantId: string,
  planId: string,
) {
  const result = await db.query<ConversationActionPlanRow>(
    `select *
     from conversation_action_plans
     where tenant_id = $1 and id = $2
     for update`,
    [tenantId, planId],
  );
  return result.rows[0] ?? null;
}

export async function findActionPlanRevisionByPreviousPlan(
  db: DbClient,
  tenantId: string,
  previousPlanId: string,
) {
  const result = await db.query<ConversationActionPlanRow>(
    `select *
     from conversation_action_plans
     where tenant_id = $1 and supersedes_plan_id = $2`,
    [tenantId, previousPlanId],
  );
  return result.rows[0] ?? null;
}

export async function listActionPlanRowsByThread(
  db: DbClient,
  tenantId: string,
  threadId: string,
) {
  const result = await db.query<ConversationActionPlanRow>(
    `select *
     from conversation_action_plans
     where tenant_id = $1 and thread_id = $2
     order by created_at desc, id desc`,
    [tenantId, threadId],
  );
  return result.rows;
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
    supersedesPlanId?: string | null;
    revisionRequestFingerprint?: string | null;
  },
) {
  const result = await db.query<ConversationActionPlanRow>(
    `insert into conversation_action_plans (
       id, tenant_id, thread_id, source_message_id, schema_version,
       generation_source, model_reference, approval_status, intent,
       business_goal, confidence, risk_summary, estimated_cost_minor,
       estimated_cost_currency, plan_json, plan_fingerprint, created_by,
       created_at, updated_at, decided_by, decided_at, decision_reason,
       supersedes_plan_id, revision_request_fingerprint
     ) values (
       $1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17, $17, $18, $19, $20, $21, $22
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
      input.supersedesPlanId ?? null,
      input.revisionRequestFingerprint ?? null,
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

export async function lockActionPlanStepRows(
  db: DbClient,
  tenantId: string,
  planId: string,
) {
  const result = await db.query<ConversationActionPlanStepRow>(
    `select *
     from conversation_action_plan_steps
     where tenant_id = $1 and plan_id = $2
     order by position asc
     for share`,
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

export async function lockActionPlanApproval(
  db: DbClient,
  tenantId: string,
  planId: string,
) {
  const result = await db.query<ApprovalRow>(
    `select *
     from approvals
     where tenant_id = $1 and target_type = 'conversation_action_plan'
       and target_id = $2
     for share`,
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

export async function updateActionPlanExecutionStatus(
  db: DbClient,
  tenantId: string,
  planId: string,
  status: "running" | "succeeded" | "failed",
) {
  const eligibleStatuses =
    status === "running" ? ["approved"] : ["approved", "running"];
  const placeholders = eligibleStatuses
    .map((_, index) => `$${index + 4}`)
    .join(", ");
  await db.query(
    `update conversation_action_plan_steps
     set status = $1
     where tenant_id = $2 and plan_id = $3
       and status in (${placeholders})`,
    [status, tenantId, planId, ...eligibleStatuses],
  );
}

export async function updateActionPlanStepStatusByPosition(
  db: DbClient,
  input: {
    tenantId: string;
    planId: string;
    position: number;
    status: "succeeded" | "failed";
  },
) {
  await db.query(
    `update conversation_action_plan_steps
     set status = $1
     where tenant_id = $2 and plan_id = $3 and position = $4
       and status <> 'cancelled'`,
    [input.status, input.tenantId, input.planId, input.position],
  );
}

export async function markActionPlanExecuted(
  db: DbClient,
  tenantId: string,
  planId: string,
  updatedAt: string,
) {
  const result = await db.query<ConversationActionPlanRow>(
    `update conversation_action_plans
     set approval_status = 'executed', updated_at = $1
     where tenant_id = $2 and id = $3 and approval_status = 'approved'
     returning *`,
    [updatedAt, tenantId, planId],
  );
  return result.rows[0] ?? null;
}
