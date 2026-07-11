import type { DbClient } from "@/lib/db";
import { id, nowIso, toJson } from "@/lib/security";
import {
  workflowDefinitionSchema,
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
        input: { message: "Nouveau lead site à traiter." },
      },
      {
        type: "create_activity",
        input: { summary: "Workflow de relance lead exécuté." },
      },
    ],
    retryPolicy: { maxAttempts: 3, backoffMs: 500 },
    timeoutMs: 30_000,
    approvalPolicy: "no_approval_required",
  });

export async function enqueueDomainEvent(db: DbClient, event: WorkflowEvent) {
  const now = nowIso();
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
  return executeWorkflowDefinition(db, leadFollowUpWorkflow, {
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
    idempotencyKey: `lead.created:${input.leadId}:workflow:v1`,
  });
}

export async function executeWorkflowDefinition(
  db: DbClient,
  definition: WorkflowDefinition,
  event: WorkflowEvent,
) {
  const parsedDefinition = workflowDefinitionSchema.parse(definition);
  await enqueueDomainEvent(db, event);

  if (!parsedDefinition.active || parsedDefinition.trigger !== event.type) {
    return null;
  }

  const runId = id("run");
  const now = nowIso();

  await db.query(
    `insert into workflow_runs (id, tenant_id, workflow_key, trigger_name, status, summary, error, retry_count, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      runId,
      event.tenantId,
      parsedDefinition.key,
      parsedDefinition.trigger,
      "running",
      "Workflow en cours d'exécution.",
      null,
      0,
      now,
    ],
  );

  try {
    for (const action of parsedDefinition.actions) {
      await executeAction(db, runId, event, action.type, action.input);
    }

    await db.query(
      "update workflow_runs set status = $1, summary = $2 where tenant_id = $3 and id = $4",
      [
        "succeeded",
        "Tâche de relance créée et notification mock envoyée.",
        event.tenantId,
        runId,
      ],
    );
    await db.query(
      "update domain_events set status = $1, attempts = attempts + 1, updated_at = $2 where tenant_id = $3 and idempotency_key = $4",
      ["succeeded", nowIso(), event.tenantId, event.idempotencyKey],
    );
    return runId;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow failed";
    await db.query(
      "update workflow_runs set status = $1, summary = $2, error = $3, retry_count = retry_count + 1 where tenant_id = $4 and id = $5",
      ["failed", "Le workflow a échoué.", message, event.tenantId, runId],
    );
    await db.query(
      "update domain_events set status = $1, attempts = attempts + 1, last_error = $2, updated_at = $3 where tenant_id = $4 and idempotency_key = $5",
      ["failed", message, nowIso(), event.tenantId, event.idempotencyKey],
    );
    throw error;
  }
}

async function executeAction(
  db: DbClient,
  runId: string,
  event: WorkflowEvent,
  actionName: string,
  input: Record<string, unknown>,
) {
  const payload = event.payload;
  const now = nowIso();

  if (actionName === "create_task") {
    await db.query(
      `insert into tasks (id, tenant_id, title, status, assigned_user_id, due_at, related_type, related_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id("task"),
        event.tenantId,
        String(input.title ?? "Relancer le nouveau lead"),
        "open",
        String(payload.ownerId),
        new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        "lead",
        String(payload.leadId),
        now,
      ],
    );
  }

  if (actionName === "send_mock_email") {
    await db.query(
      "insert into notifications (id, tenant_id, channel, recipient_user_id, message, status, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
      [
        id("notification"),
        event.tenantId,
        "mock_email",
        String(payload.ownerId),
        String(input.message ?? "Notification mock envoyée."),
        "sent",
        now,
      ],
    );
  }

  if (actionName === "create_activity") {
    await db.query(
      "insert into activities (id, tenant_id, type, summary, target_type, target_id, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
      [
        id("activity"),
        event.tenantId,
        "workflow.action",
        String(input.summary ?? "Action workflow exécutée."),
        "workflow_run",
        runId,
        now,
      ],
    );
  }

  await db.query(
    `insert into workflow_run_steps (id, tenant_id, workflow_run_id, action_name, status, safe_metadata, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id("step"),
      event.tenantId,
      runId,
      actionName,
      "succeeded",
      toJson({ eventId: event.id, input }),
      now,
    ],
  );
}
