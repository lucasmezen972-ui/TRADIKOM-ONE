import type { DbClient } from "@/lib/db";
import { id, nowIso, toJson } from "@/lib/security";
import { executeWorkflowAction } from "@/modules/workflows/actions";
import { WorkflowError } from "@/modules/workflows/errors";
import {
  findActiveWorkflowDefinition,
  findSucceededWorkflowStepByIdempotency,
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
      now,
      null,
      now,
      now,
    ],
  );

  return true;
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
    let terminalStatus = "succeeded";
    let terminalSummary = `Workflow v${parsedDefinition.version} execute.`;

    for (const [index, action] of parsedDefinition.actions.entries()) {
      const result = await executeAction(db, {
        runId,
        event,
        definition: parsedDefinition,
        action,
        actionIndex: index,
      });

      if (result.status === "waiting" || result.status === "approval_required") {
        terminalStatus = result.status;
        terminalSummary = result.summary;
        break;
      }
    }

    await updateWorkflowRunStatus(db, {
      tenantId: event.tenantId,
      runId,
      status: terminalStatus,
      summary: terminalSummary,
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
