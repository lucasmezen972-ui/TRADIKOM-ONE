import type { DbClient } from "@/lib/db";
import { safeJson, toJson } from "@/lib/security";
import { WorkflowError } from "@/modules/workflows/errors";
import {
  workflowDefinitionSchema,
  type WorkflowAction,
  type WorkflowDefinition,
} from "@/modules/workflows/types";

type WorkflowRow = {
  id: string;
  tenant_id: string;
  workflow_key: string;
  name: string;
  trigger_name: string;
  status: string;
  approval_policy: string;
  definition: string;
  created_at: string;
};

export type WorkflowRunRow = {
  id: string;
  tenant_id: string;
  workflow_key: string;
  trigger_name: string;
  status: string;
  summary: string;
  error: string | null;
  retry_count: number;
  created_at: string;
};

export type ApprovalRow = {
  id: string;
  tenant_id: string;
  requested_by: string;
  policy: string;
  status: string;
  target_type: string;
  target_id: string;
  created_at: string;
};

export type DomainEventRow = {
  id: string;
  tenant_id: string;
  actor_id: string;
  event_type: string;
  payload: string;
  idempotency_key: string;
  correlation_id: string;
  causation_id: string | null;
};

export type FailedDomainEventRow = {
  id: string;
  tenant_id: string;
  event_type: string;
  attempts: number;
  correlation_id: string;
  last_error: string | null;
  last_attempted_at: string | null;
  last_retry_delay_ms: number;
  failure_classification: string | null;
  max_attempts: number | null;
  created_at: string;
  updated_at: string;
};

export type DomainEventQueueSummaryRow = {
  status: string;
  count: number | string;
  oldest_next_run_at: string | null;
  latest_updated_at: string | null;
};

export type DomainEventQueueRow = {
  id: string;
  tenant_id: string;
  event_type: string;
  status: string;
  attempts: number;
  next_run_at: string;
  last_attempted_at: string | null;
  last_retry_delay_ms: number;
  failure_classification: string | null;
  correlation_id: string;
  created_at: string;
  updated_at: string;
};

export type WorkflowActionCursor = {
  actionIndex: number;
  actionName: string;
  eventId: string;
  status: string;
};

export type StoredWorkflowDefinition = {
  workflowId: string;
  tenantId: string;
  name: string;
  definition: WorkflowDefinition;
};

export async function findActiveWorkflowDefinition(
  db: DbClient,
  tenantId: string,
  workflowKey: string,
): Promise<StoredWorkflowDefinition | null> {
  const result = await db.query<WorkflowRow>(
    `select *
     from workflows
     where tenant_id = $1 and workflow_key = $2 and status = $3
     limit 1`,
    [tenantId, workflowKey, "active"],
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    workflowId: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    definition: normalizeStoredWorkflowDefinition(row),
  };
}

export async function insertWorkflowRun(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    workflowKey: string;
    triggerName: string;
    status: string;
    summary: string;
    error?: string | null;
    retryCount?: number;
    createdAt: string;
  },
) {
  await db.query(
    `insert into workflow_runs (id, tenant_id, workflow_key, trigger_name, status, summary, error, retry_count, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.id,
      input.tenantId,
      input.workflowKey,
      input.triggerName,
      input.status,
      input.summary,
      input.error ?? null,
      input.retryCount ?? 0,
      input.createdAt,
    ],
  );
}

export async function listWorkflowRunRows(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const runs = await db.query<WorkflowRunRow>(
    `select *
     from workflow_runs
     where tenant_id = $1
     order by created_at desc
     limit ${safeLimit}`,
    [tenantId],
  );

  return runs.rows;
}

export async function findWorkflowRunById(
  db: DbClient,
  tenantId: string,
  runId: string,
) {
  const result = await db.query<WorkflowRunRow>(
    "select * from workflow_runs where tenant_id = $1 and id = $2 limit 1",
    [tenantId, runId],
  );

  return result.rows[0] ?? null;
}

export async function updateWorkflowRunStatus(
  db: DbClient,
  input: {
    tenantId: string;
    runId: string;
    status: string;
    summary: string;
    error?: string | null;
    incrementRetry?: boolean;
  },
) {
  await db.query(
    `update workflow_runs
     set status = $1,
         summary = $2,
         error = $3,
         retry_count = retry_count + $4
     where tenant_id = $5 and id = $6`,
    [
      input.status,
      input.summary,
      input.error ?? null,
      input.incrementRetry ? 1 : 0,
      input.tenantId,
      input.runId,
    ],
  );
}

export async function findSucceededWorkflowStepByIdempotency(
  db: DbClient,
  input: {
    tenantId: string;
    runId: string;
    actionName: string;
    idempotencyKey: string;
  },
) {
  const needle = `"idempotencyKey":"${input.idempotencyKey.replaceAll("\"", "\\\"")}"`;
  const result = await db.query<{ id: string }>(
    `select id
     from workflow_run_steps
     where tenant_id = $1
       and workflow_run_id = $2
       and action_name = $3
       and status = $4
       and safe_metadata like $5
     limit 1`,
    [
      input.tenantId,
      input.runId,
      input.actionName,
      "succeeded",
      `%${needle}%`,
    ],
  );

  return result.rows[0] ?? null;
}

export async function insertWorkflowRunStep(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    runId: string;
    actionName: string;
    status: string;
    metadata: Record<string, unknown>;
    attempts?: number;
    scheduledAt?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    error?: string | null;
    createdAt: string;
  },
) {
  await db.query(
    `insert into workflow_run_steps (
       id,
       tenant_id,
       workflow_run_id,
       action_name,
       status,
       safe_metadata,
       attempts,
       scheduled_at,
       started_at,
       completed_at,
       error,
       created_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      input.id,
      input.tenantId,
      input.runId,
      input.actionName,
      input.status,
      toJson(input.metadata),
      input.attempts ?? 1,
      input.scheduledAt ?? input.createdAt,
      input.startedAt ?? input.createdAt,
      input.completedAt ?? input.createdAt,
      input.error ?? null,
      input.createdAt,
    ],
  );
}

export async function countWorkflowActionAttempts(
  db: DbClient,
  input: {
    tenantId: string;
    runId: string;
    actionIndex: number;
  },
) {
  const needle = `"actionIndex":${input.actionIndex}`;
  const result = await db.query<{ count: number | string }>(
    `select count(*)::int as count
     from workflow_run_steps
     where tenant_id = $1
       and workflow_run_id = $2
       and safe_metadata like $3
       and status <> $4`,
    [input.tenantId, input.runId, `%${needle}%`, "skipped"],
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function findPendingApprovalForRun(
  db: DbClient,
  tenantId: string,
  runId: string,
) {
  const result = await db.query<ApprovalRow>(
    `select *
     from approvals
     where tenant_id = $1
       and target_type = $2
       and target_id = $3
       and status = $4
     order by created_at desc
     limit 1`,
    [tenantId, "workflow_run", runId, "pending"],
  );

  return result.rows[0] ?? null;
}

export async function findDomainEventById(
  db: DbClient,
  tenantId: string,
  eventId: string,
) {
  const result = await db.query<DomainEventRow>(
    `select id, tenant_id, actor_id, event_type, payload, idempotency_key, correlation_id, causation_id
     from domain_events
     where tenant_id = $1 and id = $2
     limit 1`,
    [tenantId, eventId],
  );

  return result.rows[0] ?? null;
}

export async function listDomainEventQueueSummaryRows(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<DomainEventQueueSummaryRow>(
    `select status,
            count(*)::int as count,
            min(next_run_at) as oldest_next_run_at,
            max(updated_at) as latest_updated_at
     from domain_events
     where tenant_id = $1
     group by status
     order by status asc`,
    [tenantId],
  );

  return result.rows;
}

export async function listActiveDomainEventQueueRows(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const result = await db.query<DomainEventQueueRow>(
    `select id,
            tenant_id,
            event_type,
            status,
            attempts,
            next_run_at,
            last_attempted_at,
            last_retry_delay_ms,
            failure_classification,
            correlation_id,
            created_at,
            updated_at
     from domain_events
     where tenant_id = $1 and status in ($2, $3)
     order by next_run_at asc, updated_at desc
     limit ${safeLimit}`,
    [tenantId, "pending", "processing"],
  );

  return result.rows;
}

export async function findActiveDomainEventQueueRow(
  db: DbClient,
  tenantId: string,
  eventId: string,
) {
  const result = await db.query<DomainEventQueueRow>(
    `select id,
            tenant_id,
            event_type,
            status,
            attempts,
            next_run_at,
            last_attempted_at,
            last_retry_delay_ms,
            failure_classification,
            correlation_id,
            created_at,
            updated_at
     from domain_events
     where tenant_id = $1
       and id = $2
       and status in ($3, $4)
     limit 1`,
    [tenantId, eventId, "pending", "processing"],
  );

  return result.rows[0] ?? null;
}

export async function cancelActiveDomainEvent(
  db: DbClient,
  input: {
    tenantId: string;
    eventId: string;
    updatedAt: string;
  },
) {
  const result = await db.query<{ id: string }>(
    `update domain_events
     set status = $1,
         last_error = $2,
         last_retry_delay_ms = 0,
         failure_classification = $3,
         next_run_at = $4,
         updated_at = $4
     where tenant_id = $5
       and id = $6
       and status in ($7, $8)
     returning id`,
    [
      "skipped",
      "Cancelled manually by workflow operator.",
      "operator_cancelled",
      input.updatedAt,
      input.tenantId,
      input.eventId,
      "pending",
      "processing",
    ],
  );

  return result.rows[0] ?? null;
}

export async function listFailedDomainEventRows(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const result = await db.query<FailedDomainEventRow>(
    `select id,
            tenant_id,
            event_type,
            attempts,
            correlation_id,
            last_error,
            last_attempted_at,
            last_retry_delay_ms,
            failure_classification,
            max_attempts,
            created_at,
            updated_at
     from domain_events
     where tenant_id = $1 and status = $2
     order by updated_at desc, created_at desc
     limit ${safeLimit}`,
    [tenantId, "failed"],
  );

  return result.rows;
}

export async function findFailedDomainEventRow(
  db: DbClient,
  tenantId: string,
  eventId: string,
) {
  const result = await db.query<FailedDomainEventRow>(
    `select id,
            tenant_id,
            event_type,
            attempts,
            correlation_id,
            last_error,
            last_attempted_at,
            last_retry_delay_ms,
            failure_classification,
            max_attempts,
            created_at,
            updated_at
     from domain_events
     where tenant_id = $1 and id = $2 and status = $3
     limit 1`,
    [tenantId, eventId, "failed"],
  );

  return result.rows[0] ?? null;
}

export async function requeueFailedDomainEvent(
  db: DbClient,
  input: {
    tenantId: string;
    eventId: string;
    nextRunAt: string;
  },
) {
  const result = await db.query<{ id: string }>(
    `update domain_events
     set status = $1,
         attempts = 0,
         last_error = null,
         last_attempted_at = null,
         last_retry_delay_ms = 0,
         failure_classification = null,
         max_attempts = null,
         next_run_at = $2,
         updated_at = $2
     where tenant_id = $3 and id = $4 and status = $5
     returning id`,
    [
      "pending",
      input.nextRunAt,
      input.tenantId,
      input.eventId,
      "failed",
    ],
  );

  return result.rows[0] ?? null;
}

export async function findLatestWorkflowActionCursor(
  db: DbClient,
  tenantId: string,
  runId: string,
) {
  return findWorkflowActionCursor(db, tenantId, runId);
}

export async function findLatestFailedWorkflowActionCursor(
  db: DbClient,
  tenantId: string,
  runId: string,
) {
  return findWorkflowActionCursor(db, tenantId, runId, "failed");
}

export async function updateApprovalStatus(
  db: DbClient,
  tenantId: string,
  approvalId: string,
  status: "approved" | "rejected",
) {
  await db.query(
    "update approvals set status = $1 where tenant_id = $2 and id = $3",
    [status, tenantId, approvalId],
  );
}

async function findWorkflowActionCursor(
  db: DbClient,
  tenantId: string,
  runId: string,
  status?: string,
): Promise<WorkflowActionCursor | null> {
  const statusClause = status ? "and status = $4" : "";
  const params = status
    ? [tenantId, runId, `%"actionIndex":%`, status]
    : [tenantId, runId, `%"actionIndex":%`];
  const result = await db.query<{
    action_name: string;
    status: string;
    safe_metadata: string;
  }>(
    `select action_name, status, safe_metadata
     from workflow_run_steps
     where tenant_id = $1
       and workflow_run_id = $2
       and safe_metadata like $3
       ${statusClause}
     order by created_at desc
     limit 1`,
    params,
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const metadata = safeJson<Record<string, unknown>>(row.safe_metadata, {});
  const actionIndex = metadata.actionIndex;
  const eventId = metadata.eventId;

  if (typeof actionIndex !== "number" || typeof eventId !== "string") {
    return null;
  }

  return {
    actionIndex,
    actionName: row.action_name,
    eventId,
    status: row.status,
  };
}

function normalizeStoredWorkflowDefinition(row: WorkflowRow) {
  const stored = safeJson<Record<string, unknown>>(row.definition, {});
  const candidate = {
    key: stringValue(stored.key, row.workflow_key),
    version: numberValue(stored.version, 1),
    trigger: stringValue(stored.trigger, row.trigger_name),
    active:
      typeof stored.active === "boolean" ? stored.active : row.status === "active",
    conditions: stringArray(stored.conditions),
    actions: normalizeActions(stored.actions),
    retryPolicy: normalizeRetryPolicy(stored.retryPolicy),
    timeoutMs: numberValue(stored.timeoutMs, 30_000),
    approvalPolicy: stringValue(stored.approvalPolicy, row.approval_policy),
  };

  const parsed = workflowDefinitionSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new WorkflowError(
      "workflow_definition_invalid",
      "Definition workflow invalide.",
    );
  }

  return parsed.data;
}

function normalizeActions(actions: unknown): WorkflowAction[] {
  if (!Array.isArray(actions)) {
    return [];
  }

  return actions.map((action) => {
    if (typeof action === "string") {
      return { type: action as WorkflowAction["type"], input: {} };
    }

    if (action && typeof action === "object") {
      return action as WorkflowAction;
    }

    return { type: "create_activity" as const, input: {} };
  });
}

function normalizeRetryPolicy(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { maxAttempts: 3, backoffMs: 500 };
  }

  const retryPolicy = value as Record<string, unknown>;
  return {
    maxAttempts: numberValue(retryPolicy.maxAttempts, 3),
    backoffMs: numberValue(retryPolicy.backoffMs, 500),
  };
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}
