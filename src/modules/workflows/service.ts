import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import type { Role, WorkflowRun } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import { assertTenantAccess } from "@/modules/tenants";
import { WorkflowError } from "@/modules/workflows/errors";
import {
  enqueueResumeForLatestWorkflowAction,
  enqueueWorkflowResumeEvent,
} from "@/modules/workflows/engine";
import {
  findLatestFailedWorkflowActionCursor,
  findPendingApprovalForRun,
  findWorkflowRunById,
  insertWorkflowRunStep,
  listWorkflowRunRows,
  updateApprovalStatus,
  updateWorkflowRunStatus,
} from "@/modules/workflows/repository";
import {
  workflowRunControlSchema,
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
  await enqueueResumeForLatestWorkflowAction(db, {
    tenantId,
    runId: run.id,
    actorId: userId,
    reason: "approval_granted",
  });
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

function isTerminalStatus(status: string) {
  return ["succeeded", "failed", "cancelled", "rejected"].includes(status);
}
