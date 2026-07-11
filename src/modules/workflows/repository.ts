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
    createdAt: string;
  },
) {
  await db.query(
    `insert into workflow_run_steps (id, tenant_id, workflow_run_id, action_name, status, safe_metadata, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.id,
      input.tenantId,
      input.runId,
      input.actionName,
      input.status,
      toJson(input.metadata),
      input.createdAt,
    ],
  );
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
