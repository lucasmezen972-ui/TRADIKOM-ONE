import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import type {
  Role,
  WorkflowDeadLetterEvent,
  WorkflowQueueEvent,
  WorkflowQueueOverview,
  WorkflowQueueStatus,
  WorkflowQueueSummary,
  WorkflowRun,
} from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import { assertTenantAccess } from "@/modules/tenants";
import { WorkflowError } from "@/modules/workflows/errors";
import {
  enqueueResumeForLatestWorkflowAction,
  enqueueWorkflowResumeEvent,
} from "@/modules/workflows/engine";
import {
  cancelActiveDomainEvent,
  findActiveDomainEventQueueRow,
  findLatestFailedWorkflowActionCursor,
  findFailedDomainEventRow,
  findPendingApprovalForRun,
  findWorkflowRunById,
  insertWorkflowRunStep,
  listActiveDomainEventQueueRows,
  listDomainEventQueueSummaryRows,
  listFailedDomainEventRows,
  listWorkflowRunRows,
  requeueFailedDomainEvent,
  updateApprovalStatus,
  updateWorkflowRunStatus,
} from "@/modules/workflows/repository";
import {
  workflowDeadLetterRetrySchema,
  workflowQueueEventControlSchema,
  workflowRunControlSchema,
  type WorkflowDeadLetterRetryInput,
  type WorkflowQueueEventControlInput,
  type WorkflowRunControlInput,
} from "@/modules/workflows/schemas";

const workflowControlRoles: Role[] = ["owner", "administrator", "manager"];

export async function getWorkflowRuns(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const runs = await listWorkflowRunRows(db, tenantId, 20);

  return runs.map(mapWorkflowRun) satisfies WorkflowRun[];
}

export async function getWorkflowDeadLetters(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const events = await listFailedDomainEventRows(db, tenantId, 20);

  return events.map(mapWorkflowDeadLetter) satisfies WorkflowDeadLetterEvent[];
}

export async function getWorkflowQueueOverview(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const [summaryRows, activeRows] = await Promise.all([
    listDomainEventQueueSummaryRows(db, tenantId),
    listActiveDomainEventQueueRows(db, tenantId, 12),
  ]);

  return {
    summary: normalizeQueueSummary(summaryRows.map(mapWorkflowQueueSummary)),
    activeEvents: activeRows.map(mapWorkflowQueueEvent),
  } satisfies WorkflowQueueOverview;
}

export async function cancelWorkflowRun(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: WorkflowRunControlInput,
) {
  await assertTenantAccess(db, userId, tenantId, workflowControlRoles);
  const run = await requireWorkflowRun(db, tenantId, input);

  if (isTerminalStatus(run.status)) {
    throw new WorkflowError(
      "workflow_run_not_actionable",
      "Cette execution workflow est deja terminee.",
    );
  }

  await updateWorkflowRunStatus(db, {
    tenantId,
    runId: run.id,
    status: "cancelled",
    summary: "Execution workflow annulee manuellement.",
    error: null,
  });
  await insertControlStep(db, tenantId, run.id, "workflow.cancelled", "cancelled", {
    actorId: userId,
  });
  await auditWorkflowControl(db, tenantId, userId, "workflow.cancelled", run.id);
}

export async function approveWorkflowRun(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: WorkflowRunControlInput,
) {
  await assertTenantAccess(db, userId, tenantId, workflowControlRoles);
  const run = await requireWorkflowRun(db, tenantId, input);

  if (run.status !== "approval_required") {
    throw new WorkflowError(
      "workflow_run_not_actionable",
      "Cette execution workflow n'attend pas d'approbation.",
    );
  }

  const approval = await requirePendingApproval(db, tenantId, run.id);
  await updateApprovalStatus(db, tenantId, approval.id, "approved");
  await updateWorkflowRunStatus(db, {
    tenantId,
    runId: run.id,
    status: "waiting",
    summary: "Workflow approuve; reprise en attente.",
    error: null,
  });
  await insertControlStep(db, tenantId, run.id, "workflow.approved", "succeeded", {
    actorId: userId,
    approvalId: approval.id,
  });
  await enqueueApprovalResumeWhenPossible(db, tenantId, run.id, userId);
  await auditWorkflowControl(db, tenantId, userId, "workflow.approved", run.id);
}

export async function rejectWorkflowRun(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: WorkflowRunControlInput,
) {
  await assertTenantAccess(db, userId, tenantId, workflowControlRoles);
  const run = await requireWorkflowRun(db, tenantId, input);

  if (run.status !== "approval_required") {
    throw new WorkflowError(
      "workflow_run_not_actionable",
      "Cette execution workflow n'attend pas d'approbation.",
    );
  }

  const approval = await requirePendingApproval(db, tenantId, run.id);
  await updateApprovalStatus(db, tenantId, approval.id, "rejected");
  await updateWorkflowRunStatus(db, {
    tenantId,
    runId: run.id,
    status: "rejected",
    summary: "Workflow rejete manuellement.",
    error: "Approval rejected.",
  });
  await insertControlStep(db, tenantId, run.id, "workflow.rejected", "failed", {
    actorId: userId,
    approvalId: approval.id,
  });
  await auditWorkflowControl(db, tenantId, userId, "workflow.rejected", run.id);
}

export async function requestManualWorkflowRetry(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: WorkflowRunControlInput,
) {
  await assertTenantAccess(db, userId, tenantId, workflowControlRoles);
  const run = await requireWorkflowRun(db, tenantId, input);

  if (!["failed", "rejected", "cancelled"].includes(run.status)) {
    throw new WorkflowError(
      "workflow_run_not_actionable",
      "Cette execution workflow ne peut pas etre relancee manuellement.",
    );
  }

  await updateWorkflowRunStatus(db, {
    tenantId,
    runId: run.id,
    status: "waiting",
    summary: "Retry manuel demande; reprise en attente.",
    error: null,
    incrementRetry: true,
  });
  await insertControlStep(db, tenantId, run.id, "workflow.manual_retry", "waiting", {
    actorId: userId,
  });
  const failedCursor = await findLatestFailedWorkflowActionCursor(
    db,
    tenantId,
    run.id,
  );

  if (failedCursor) {
    await enqueueWorkflowResumeEvent(db, {
      tenantId,
      runId: run.id,
      actorId: userId,
      sourceEventId: failedCursor.eventId,
      correlationId: `workflow.manual_retry:${run.id}`,
      resumeFromActionIndex: failedCursor.actionIndex,
      reason: "manual_retry",
      resumeKey: `retry${Number(run.retry_count) + 1}`,
    });
  }

  await auditWorkflowControl(
    db,
    tenantId,
    userId,
    "workflow.manual_retry_requested",
    run.id,
  );
}

export async function retryWorkflowDeadLetter(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: WorkflowDeadLetterRetryInput,
) {
  await assertTenantAccess(db, userId, tenantId, workflowControlRoles);
  const parsed = workflowDeadLetterRetrySchema.parse(input);
  const failedEvent = await findFailedDomainEventRow(db, tenantId, parsed.eventId);

  if (!failedEvent) {
    throw new WorkflowError(
      "workflow_dead_letter_not_found",
      "Incident workflow introuvable ou deja relance.",
    );
  }

  const requeued = await requeueFailedDomainEvent(db, {
    tenantId,
    eventId: parsed.eventId,
    nextRunAt: nowIso(),
  });

  if (!requeued) {
    throw new WorkflowError(
      "workflow_dead_letter_not_found",
      "Incident workflow introuvable ou deja relance.",
    );
  }

  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "workflow.dead_letter_retried",
    targetType: "domain_event",
    targetId: parsed.eventId,
    metadata: {
      eventType: failedEvent.event_type,
      previousAttempts: Number(failedEvent.attempts),
      correlationId: failedEvent.correlation_id,
    },
  });

  return { eventId: parsed.eventId };
}

export async function cancelWorkflowQueueEvent(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: WorkflowQueueEventControlInput,
) {
  await assertTenantAccess(db, userId, tenantId, workflowControlRoles);
  const parsed = workflowQueueEventControlSchema.parse(input);
  const activeEvent = await findActiveDomainEventQueueRow(
    db,
    tenantId,
    parsed.eventId,
  );

  if (!activeEvent) {
    throw new WorkflowError(
      "workflow_queue_event_not_found",
      "Evenement workflow introuvable ou deja termine.",
    );
  }

  const cancelled = await cancelActiveDomainEvent(db, {
    tenantId,
    eventId: parsed.eventId,
    updatedAt: nowIso(),
  });

  if (!cancelled) {
    throw new WorkflowError(
      "workflow_queue_event_not_found",
      "Evenement workflow introuvable ou deja termine.",
    );
  }

  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "workflow.queue_event_cancelled",
    targetType: "domain_event",
    targetId: parsed.eventId,
    metadata: {
      eventType: activeEvent.event_type,
      previousStatus: activeEvent.status,
      attempts: Number(activeEvent.attempts),
      correlationId: activeEvent.correlation_id,
    },
  });

  return { eventId: parsed.eventId };
}

async function requireWorkflowRun(
  db: DbClient,
  tenantId: string,
  input: WorkflowRunControlInput,
) {
  const parsed = workflowRunControlSchema.parse(input);
  const run = await findWorkflowRunById(db, tenantId, parsed.runId);

  if (!run) {
    throw new WorkflowError(
      "workflow_run_not_found",
      "Execution workflow introuvable.",
    );
  }

  return run;
}

async function requirePendingApproval(
  db: DbClient,
  tenantId: string,
  runId: string,
) {
  const approval = await findPendingApprovalForRun(db, tenantId, runId);

  if (!approval) {
    throw new WorkflowError(
      "workflow_approval_not_found",
      "Approbation workflow introuvable.",
    );
  }

  return approval;
}

async function insertControlStep(
  db: DbClient,
  tenantId: string,
  runId: string,
  actionName: string,
  status: string,
  metadata: Record<string, unknown>,
) {
  await insertWorkflowRunStep(db, {
    id: id("step"),
    tenantId,
    runId,
    actionName,
    status,
    metadata,
    createdAt: nowIso(),
  });
}

async function auditWorkflowControl(
  db: DbClient,
  tenantId: string,
  actorId: string,
  action: string,
  runId: string,
) {
  await recordAuditLog(db, {
    tenantId,
    actorId,
    action,
    targetType: "workflow_run",
    targetId: runId,
    metadata: {},
  });
}

async function enqueueApprovalResumeWhenPossible(
  db: DbClient,
  tenantId: string,
  runId: string,
  actorId: string,
) {
  try {
    await enqueueResumeForLatestWorkflowAction(db, {
      tenantId,
      runId,
      actorId,
      reason: "approval_granted",
    });
  } catch (error) {
    if (
      error instanceof WorkflowError &&
      error.code === "workflow_run_not_actionable"
    ) {
      return;
    }

    throw error;
  }
}

function mapWorkflowRun(row: {
  id: string;
  tenant_id: string;
  workflow_key: string;
  trigger_name: string;
  status: string;
  summary: string;
  created_at: string;
}) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workflowKey: row.workflow_key,
    triggerName: row.trigger_name,
    status: row.status as WorkflowRun["status"],
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function mapWorkflowDeadLetter(row: {
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
}) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    eventType: row.event_type,
    attempts: Number(row.attempts),
    lastError: safeDeadLetterError(row.last_error),
    lastAttemptedAt: row.last_attempted_at,
    lastRetryDelayMs: Number(row.last_retry_delay_ms ?? 0),
    failureClassification: row.failure_classification,
    maxAttempts: row.max_attempts === null ? null : Number(row.max_attempts),
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWorkflowQueueSummary(row: {
  status: string;
  count: number | string;
  oldest_next_run_at: string | null;
  latest_updated_at: string | null;
}) {
  return {
    status: workflowQueueStatus(row.status),
    count: Number(row.count),
    oldestNextRunAt: row.oldest_next_run_at,
    latestUpdatedAt: row.latest_updated_at,
  } satisfies WorkflowQueueSummary;
}

function mapWorkflowQueueEvent(row: {
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
}) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    eventType: row.event_type,
    status: workflowQueueStatus(row.status),
    attempts: Number(row.attempts),
    nextRunAt: row.next_run_at,
    lastAttemptedAt: row.last_attempted_at,
    lastRetryDelayMs: Number(row.last_retry_delay_ms ?? 0),
    failureClassification: row.failure_classification,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } satisfies WorkflowQueueEvent;
}

function normalizeQueueSummary(summary: WorkflowQueueSummary[]) {
  const byStatus = new Map(summary.map((item) => [item.status, item]));
  const statuses: WorkflowQueueStatus[] = [
    "pending",
    "processing",
    "failed",
    "succeeded",
    "skipped",
  ];

  return statuses.map((status) => ({
    status,
    count: byStatus.get(status)?.count ?? 0,
    oldestNextRunAt: byStatus.get(status)?.oldestNextRunAt ?? null,
    latestUpdatedAt: byStatus.get(status)?.latestUpdatedAt ?? null,
  }));
}

function workflowQueueStatus(value: string): WorkflowQueueStatus {
  if (
    value === "pending" ||
    value === "processing" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "skipped"
  ) {
    return value;
  }

  return "pending";
}

function safeDeadLetterError(value: string | null) {
  const fallback = "Erreur terminale sans detail.";
  const message = value?.trim() ? value.trim() : fallback;
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(
      /(password|token|secret|api[_-]?key)=\S+/gi,
      "$1=[redacted]",
    )
    .slice(0, 280);
}

function isTerminalStatus(status: string) {
  return ["succeeded", "failed", "cancelled", "rejected"].includes(status);
}
