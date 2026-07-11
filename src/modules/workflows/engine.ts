import type { DbClient } from "@/lib/db";
import { id, nowIso, safeJson, toJson } from "@/lib/security";
import { executeWorkflowAction } from "@/modules/workflows/actions";
import { WorkflowError } from "@/modules/workflows/errors";
import {
  findDomainEventById,
  findActiveWorkflowDefinition,
  findLatestWorkflowActionCursor,
  findSucceededWorkflowStepByIdempotency,
  findWorkflowRunById,
  insertWorkflowRun,
  insertWorkflowRunStep,
  updateWorkflowRunStatus,
} from "@/modules/workflows/repository";
import {
  workflowDefinitionSchema,
  type WorkflowAction,
  type WorkflowDefinition,
  type WorkflowEvent,
} from "@/modules/workflows/types";

export const workflowResumeEventType = "workflow.resume";

export const leadFollowUpWorkflow: WorkflowDefinition =
  workflowDefinitionSchema.parse({
    key: "new_website_lead_follow_up",
    version: 1,
    trigger: "lead.created",
    active: true,
    conditions: ["payload.source == website || payload.source == webhook"],
    actions: [
      {
        type: "create_task",
        input: { title: "Relancer le nouveau lead site sous 24h" },
      },
      {
        type: "send_mock_email",
        input: { message: "Nouveau lead site a traiter." },
      },
      {
        type: "create_activity",
        input: { summary: "Workflow de relance lead execute." },
      },
    ],
    retryPolicy: { maxAttempts: 3, backoffMs: 500 },
    timeoutMs: 30_000,
    approvalPolicy: "no_approval_required",
  });

export async function enqueueDomainEvent(db: DbClient, event: WorkflowEvent) {
  const now = nowIso();
  const existing = await db.query<{ id: string }>(
    "select id from domain_events where tenant_id = $1 and idempotency_key = $2 limit 1",
    [event.tenantId, event.idempotencyKey],
  );

  if (existing.rows[0]) {
    return false;
  }

  await db.query(
    `insert into domain_events (id, tenant_id, actor_id, event_type, payload, status, attempts, idempotency_key, correlation_id, causation_id, next_run_at, last_error, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (tenant_id, idempotency_key) do nothing`,
    [
      event.id,
      event.tenantId,
      event.actorId,
      event.type,
      toJson(event.payload),
      "pending",
      0,
      event.idempotencyKey,
      event.correlationId,
      event.causationId ?? null,
      event.nextRunAt ?? now,
      null,
      now,
      now,
    ],
  );

  return true;
}

export async function enqueueWorkflowResumeEvent(
  db: DbClient,
  input: {
    tenantId: string;
    runId: string;
    actorId: string;
    sourceEventId: string;
    correlationId: string;
    resumeFromActionIndex: number;
    nextRunAt?: string;
    reason: "wait_elapsed" | "approval_granted" | "manual_retry";
    resumeKey?: string;
  },
) {
  const resumeKey = input.resumeKey ?? input.reason;
  return enqueueDomainEvent(db, {
    id: id("event"),
    tenantId: input.tenantId,
    actorId: input.actorId,
    type: workflowResumeEventType,
    payload: {
      runId: input.runId,
      sourceEventId: input.sourceEventId,
      resumeFromActionIndex: input.resumeFromActionIndex,
      reason: input.reason,
    },
    correlationId: input.correlationId,
    causationId: input.sourceEventId,
    idempotencyKey: `workflow.resume:${input.runId}:a${input.resumeFromActionIndex}:${resumeKey}`,
    nextRunAt: input.nextRunAt,
  });
}

export async function executeLeadFollowUpWorkflow(
  db: DbClient,
  input: {
    tenantId: string;
    leadId: string;
    contactId: string;
    ownerId: string;
    source: string;
    correlationId: string;
  },
) {
  const storedWorkflow = await findActiveWorkflowDefinition(
    db,
    input.tenantId,
    leadFollowUpWorkflow.key,
  );

  if (!storedWorkflow) {
    return null;
  }

  const definition = storedWorkflow.definition;

  return executeWorkflowDefinition(db, definition, {
    id: id("event"),
    tenantId: input.tenantId,
    actorId: "system",
    type: "lead.created",
    payload: {
      leadId: input.leadId,
      contactId: input.contactId,
      ownerId: input.ownerId,
      source: input.source,
    },
    correlationId: input.correlationId,
    idempotencyKey: `lead.created:${input.leadId}:workflow:v${definition.version}`,
  });
}

export async function executeWorkflowDefinition(
  db: DbClient,
  definition: WorkflowDefinition,
  event: WorkflowEvent,
) {
  const parsedDefinition = workflowDefinitionSchema.parse(definition);
  const eventInserted = await enqueueDomainEvent(db, event);

  if (!eventInserted) {
    return null;
  }

  if (!parsedDefinition.active || parsedDefinition.trigger !== event.type) {
    await markDomainEventSkipped(
      db,
      event,
      "Workflow inactif ou declencheur non correspondant.",
    );
    return null;
  }

  if (!conditionsMatch(parsedDefinition, event)) {
    await markDomainEventSkipped(
      db,
      event,
      "Conditions workflow non satisfaites.",
    );
    return null;
  }

  const runId = id("run");
  await insertWorkflowRun(db, {
    id: runId,
    tenantId: event.tenantId,
    workflowKey: parsedDefinition.key,
    triggerName: parsedDefinition.trigger,
    status: "running",
    summary: `Workflow v${parsedDefinition.version} en cours d'execution.`,
    error: null,
    retryCount: 0,
    createdAt: nowIso(),
  });

  try {
    const terminal = await runWorkflowActions(db, {
      runId,
      event,
      definition: parsedDefinition,
      startActionIndex: 0,
    });
    await updateWorkflowRunStatus(db, {
      tenantId: event.tenantId,
      runId,
      status: terminal.status,
      summary: terminal.summary,
      error: null,
    });
    await markDomainEventSucceeded(db, event);
    return runId;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Workflow failed";
    await updateWorkflowRunStatus(db, {
      tenantId: event.tenantId,
      runId,
      status: "failed",
      summary: "Le workflow a echoue.",
      error: message,
      incrementRetry: true,
    });
    await markDomainEventFailed(db, event, message);
    throw error;
  }
}

export async function resumeWorkflowRun(db: DbClient, event: WorkflowEvent) {
  if (event.type !== workflowResumeEventType) {
    throw new WorkflowError(
      "workflow_definition_invalid",
      "Evenement de reprise workflow invalide.",
    );
  }

  const payload = parseResumePayload(event.payload);
  const run = await findWorkflowRunById(db, event.tenantId, payload.runId);

  if (!run) {
    throw new WorkflowError(
      "workflow_run_not_found",
      "Execution workflow introuvable.",
    );
  }

  if (isTerminalRunStatus(run.status)) {
    await insertWorkflowRunStep(db, {
      id: id("step"),
      tenantId: event.tenantId,
      runId: run.id,
      actionName: "workflow.resume",
      status: "skipped",
      metadata: {
        eventId: event.id,
        reason: payload.reason,
        skippedStatus: run.status,
      },
      createdAt: nowIso(),
    });
    return null;
  }

  const storedWorkflow = await findActiveWorkflowDefinition(
    db,
    event.tenantId,
    run.workflow_key,
  );

  if (!storedWorkflow) {
    throw new WorkflowError(
      "workflow_not_found",
      "Definition workflow introuvable pour la reprise.",
    );
  }

  const sourceEvent = await findDomainEventById(
    db,
    event.tenantId,
    payload.sourceEventId,
  );

  if (!sourceEvent) {
    throw new WorkflowError(
      "workflow_run_not_actionable",
      "Evenement source introuvable pour la reprise workflow.",
    );
  }

  await updateWorkflowRunStatus(db, {
    tenantId: event.tenantId,
    runId: run.id,
    status: "running",
    summary: "Workflow repris par le worker.",
    error: null,
  });

  const sourceWorkflowEvent = toWorkflowEvent(sourceEvent);

  try {
    const terminal = await runWorkflowActions(db, {
      runId: run.id,
      event: sourceWorkflowEvent,
      definition: storedWorkflow.definition,
      startActionIndex: payload.resumeFromActionIndex,
    });
    await updateWorkflowRunStatus(db, {
      tenantId: event.tenantId,
      runId: run.id,
      status: terminal.status,
      summary: terminal.summary,
      error: null,
    });
    return run.id;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Workflow resume failed";
    await updateWorkflowRunStatus(db, {
      tenantId: event.tenantId,
      runId: run.id,
      status: "failed",
      summary: "La reprise workflow a echoue.",
      error: message,
      incrementRetry: true,
    });
    throw error;
  }
}

export async function enqueueResumeForLatestWorkflowAction(
  db: DbClient,
  input: {
    tenantId: string;
    runId: string;
    actorId: string;
    reason: "approval_granted" | "manual_retry";
    resumeFromActionIndex?: number;
    resumeKey?: string;
  },
) {
  const cursor = await findLatestWorkflowActionCursor(
    db,
    input.tenantId,
    input.runId,
  );

  if (!cursor) {
    throw new WorkflowError(
      "workflow_run_not_actionable",
      "Aucune action workflow ne permet de reprendre cette execution.",
    );
  }

  return enqueueWorkflowResumeEvent(db, {
    tenantId: input.tenantId,
    runId: input.runId,
    actorId: input.actorId,
    sourceEventId: cursor.eventId,
    correlationId: `workflow.resume:${input.runId}`,
    resumeFromActionIndex:
      input.resumeFromActionIndex ?? cursor.actionIndex + 1,
    reason: input.reason,
    resumeKey: input.resumeKey,
  });
}

async function runWorkflowActions(
  db: DbClient,
  input: {
    runId: string;
    event: WorkflowEvent;
    definition: WorkflowDefinition;
    startActionIndex: number;
  },
) {
  if (input.startActionIndex >= input.definition.actions.length) {
    return {
      status: "succeeded",
      summary: `Workflow v${input.definition.version} execute.`,
    };
  }

  for (
    let actionIndex = input.startActionIndex;
    actionIndex < input.definition.actions.length;
    actionIndex += 1
  ) {
    const currentRun = await findWorkflowRunById(
      db,
      input.event.tenantId,
      input.runId,
    );

    if (currentRun && isTerminalRunStatus(currentRun.status)) {
      return {
        status: currentRun.status,
        summary: currentRun.summary,
      };
    }

    const action = input.definition.actions[actionIndex];
    if (!action) {
      break;
    }

    const result = await executeAction(db, {
      runId: input.runId,
      event: input.event,
      definition: input.definition,
      action,
      actionIndex,
    });

    if (result.status === "waiting") {
      await enqueueWorkflowResumeEvent(db, {
        tenantId: input.event.tenantId,
        runId: input.runId,
        actorId: "system",
        sourceEventId: input.event.id,
        correlationId: input.event.correlationId,
        resumeFromActionIndex: actionIndex + 1,
        nextRunAt: stringMetadata(result.metadata, "resumeAt"),
        reason: "wait_elapsed",
      });

      return {
        status: result.status,
        summary: result.summary,
      };
    }

    if (result.status === "approval_required") {
      return {
        status: result.status,
        summary: result.summary,
      };
    }
  }

  return {
    status: "succeeded",
    summary: `Workflow v${input.definition.version} execute.`,
  };
}

async function executeAction(
  db: DbClient,
  input: {
    runId: string;
    event: WorkflowEvent;
    definition: WorkflowDefinition;
    action: WorkflowAction;
    actionIndex: number;
  },
) {
  const idempotencyKey =
    input.action.idempotencyKey ??
    `${input.event.idempotencyKey}:a${input.actionIndex}:${input.action.type}`;
  const existingStep = await findSucceededWorkflowStepByIdempotency(db, {
    tenantId: input.event.tenantId,
    runId: input.runId,
    actionName: input.action.type,
    idempotencyKey,
  });

  if (existingStep) {
    await insertWorkflowRunStep(db, {
      id: id("step"),
      tenantId: input.event.tenantId,
      runId: input.runId,
      actionName: input.action.type,
      status: "skipped",
      metadata: {
        eventId: input.event.id,
        actionIndex: input.actionIndex,
        idempotencyKey,
        reason: "Action deja executee.",
      },
      createdAt: nowIso(),
    });

    return {
      status: "succeeded" as const,
      summary: "Action deja executee.",
    };
  }

  try {
    const result = await executeWorkflowAction({
      db,
      runId: input.runId,
      event: input.event,
      definition: input.definition,
      action: input.action,
      now: nowIso(),
    });

    await insertWorkflowRunStep(db, {
      id: id("step"),
      tenantId: input.event.tenantId,
      runId: input.runId,
      actionName: input.action.type,
      status: result.status,
      metadata: {
        eventId: input.event.id,
        actionIndex: input.actionIndex,
        idempotencyKey,
        input: input.action.input,
        ...result.metadata,
      },
      createdAt: nowIso(),
    });

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Action workflow echouee.";
    await insertWorkflowRunStep(db, {
      id: id("step"),
      tenantId: input.event.tenantId,
      runId: input.runId,
      actionName: input.action.type,
      status: "failed",
      metadata: {
        eventId: input.event.id,
        actionIndex: input.actionIndex,
        idempotencyKey,
        input: input.action.input,
        error: message,
      },
      createdAt: nowIso(),
    });
    throw error;
  }
}

async function markDomainEventSucceeded(db: DbClient, event: WorkflowEvent) {
  await db.query(
    "update domain_events set status = $1, attempts = attempts + 1, updated_at = $2 where tenant_id = $3 and idempotency_key = $4",
    ["succeeded", nowIso(), event.tenantId, event.idempotencyKey],
  );
}

async function markDomainEventFailed(
  db: DbClient,
  event: WorkflowEvent,
  message: string,
) {
  await db.query(
    "update domain_events set status = $1, attempts = attempts + 1, last_error = $2, updated_at = $3 where tenant_id = $4 and idempotency_key = $5",
    ["failed", message, nowIso(), event.tenantId, event.idempotencyKey],
  );
}

async function markDomainEventSkipped(
  db: DbClient,
  event: WorkflowEvent,
  message: string,
) {
  await db.query(
    "update domain_events set status = $1, attempts = attempts + 1, last_error = $2, updated_at = $3 where tenant_id = $4 and idempotency_key = $5",
    ["skipped", message, nowIso(), event.tenantId, event.idempotencyKey],
  );
}

function conditionsMatch(definition: WorkflowDefinition, event: WorkflowEvent) {
  if (definition.conditions.length === 0) {
    return true;
  }

  return definition.conditions.every((condition) =>
    condition
      .split("||")
      .map((part) => part.trim())
      .some((part) => simpleConditionMatches(part, event)),
  );
}

function simpleConditionMatches(condition: string, event: WorkflowEvent) {
  const match = condition.match(
    /^(?:payload\.)?([a-zA-Z0-9_.]+)\s*==\s*["']?([a-zA-Z0-9_-]+)["']?$/,
  );

  if (!match) {
    throw new WorkflowError(
      "workflow_definition_invalid",
      `Condition workflow non supportee: ${condition}.`,
    );
  }

  const [, path, expected] = match;
  if (!path || expected === undefined) {
    throw new WorkflowError(
      "workflow_definition_invalid",
      `Condition workflow non supportee: ${condition}.`,
    );
  }

  return String(readPayloadPath(event.payload, path) ?? "") === expected;
}

function readPayloadPath(payload: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    return (current as Record<string, unknown>)[key];
  }, payload);
}

function parseResumePayload(payload: Record<string, unknown>) {
  const runId = payload.runId;
  const sourceEventId = payload.sourceEventId;
  const resumeFromActionIndex = payload.resumeFromActionIndex;
  const reason = payload.reason;

  if (
    typeof runId !== "string" ||
    typeof sourceEventId !== "string" ||
    typeof resumeFromActionIndex !== "number" ||
    typeof reason !== "string"
  ) {
    throw new WorkflowError(
      "workflow_run_not_actionable",
      "Payload de reprise workflow invalide.",
    );
  }

  return {
    runId,
    sourceEventId,
    resumeFromActionIndex: Math.max(0, Math.floor(resumeFromActionIndex)),
    reason,
  };
}

function toWorkflowEvent(row: {
  id: string;
  tenant_id: string;
  actor_id: string;
  event_type: string;
  payload: string;
  idempotency_key: string;
  correlation_id: string;
  causation_id: string | null;
}): WorkflowEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    type: row.event_type,
    payload: safeJson<Record<string, unknown>>(row.payload, {}),
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    causationId: row.causation_id ?? undefined,
  };
}

function stringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isTerminalRunStatus(status: string) {
  return ["succeeded", "failed", "cancelled", "rejected"].includes(status);
}
