import type { DbClient } from "@/lib/db";
import { id, safeJson, toJson } from "@/lib/security";
import { WorkflowError } from "@/modules/workflows/errors";
import type {
  WorkflowAction,
  WorkflowDefinition,
  WorkflowEvent,
} from "@/modules/workflows/types";

export type WorkflowActionStatus =
  | "succeeded"
  | "waiting"
  | "approval_required";

export type WorkflowActionResult = {
  status: WorkflowActionStatus;
  summary: string;
  metadata?: Record<string, unknown>;
  stop?: boolean;
};

export type WorkflowActionContext = {
  db: DbClient;
  runId: string;
  event: WorkflowEvent;
  definition: WorkflowDefinition;
  action: WorkflowAction;
  now: string;
};

type WorkflowActionHandler = (
  context: WorkflowActionContext,
) => Promise<WorkflowActionResult>;

export const workflowActionRegistry: Record<
  WorkflowAction["type"],
  WorkflowActionHandler
> = {
  create_task: createTaskAction,
  update_contact: updateContactAction,
  add_tag: addTagAction,
  create_activity: createActivityAction,
  send_mock_email: sendMockNotificationAction("mock_email"),
  send_mock_sms: sendMockNotificationAction("mock_sms"),
  send_mock_whatsapp: sendMockNotificationAction("mock_whatsapp"),
  call_webhook: callWebhookAction,
  wait_for_duration: waitForDurationAction,
  request_approval: requestApprovalAction,
};

export async function executeWorkflowAction(
  context: WorkflowActionContext,
): Promise<WorkflowActionResult> {
  const handler = workflowActionRegistry[context.action.type];

  if (!handler) {
    throw new WorkflowError(
      "workflow_action_invalid",
      `Action workflow inconnue: ${context.action.type}.`,
    );
  }

  return handler(context);
}

async function createTaskAction({
  db,
  event,
  action,
  now,
}: WorkflowActionContext): Promise<WorkflowActionResult> {
  const ownerId = stringInput(action.input.assignedUserId, event.payload.ownerId);
  const relatedType = stringInput(action.input.relatedType, "lead");
  const relatedId = stringInput(
    action.input.relatedId,
    relatedType === "contact" ? event.payload.contactId : event.payload.leadId,
  );

  if (!ownerId || !relatedId) {
    throw new WorkflowError(
      "workflow_action_failed",
      "Impossible de creer la tache workflow sans responsable ni cible.",
    );
  }

  await db.query(
    `insert into tasks (id, tenant_id, title, status, assigned_user_id, due_at, related_type, related_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id("task"),
      event.tenantId,
      stringInput(action.input.title, "Relancer le nouveau lead"),
      "open",
      ownerId,
      stringInput(
        action.input.dueAt,
        dueAtFromHours(action.input.dueInHours, 24),
      ),
      relatedType,
      relatedId,
      now,
    ],
  );

  return {
    status: "succeeded",
    summary: "Tache creee.",
    metadata: { relatedType, relatedId },
  };
}

async function updateContactAction({
  db,
  event,
  action,
  now,
}: WorkflowActionContext): Promise<WorkflowActionResult> {
  const contactId = stringInput(action.input.contactId, event.payload.contactId);
  if (!contactId) {
    throw new WorkflowError(
      "workflow_action_failed",
      "Impossible de mettre a jour le contact sans identifiant.",
    );
  }

  const current = await db.query<{
    name: string;
    phone: string;
    status: string;
    source: string;
    tags: string;
    assigned_user_id: string | null;
  }>(
    `select name, phone, status, source, tags, assigned_user_id
     from contacts
     where tenant_id = $1 and id = $2
     limit 1`,
    [event.tenantId, contactId],
  );
  const contact = current.rows[0];

  if (!contact) {
    throw new WorkflowError("workflow_action_failed", "Contact introuvable.");
  }

  const tags =
    Array.isArray(action.input.tags) && action.input.tags.length > 0
      ? normalizeTags(action.input.tags)
      : safeJson<string[]>(contact.tags, []);

  await db.query(
    `update contacts
     set name = $1,
         phone = $2,
         status = $3,
         source = $4,
         tags = $5,
         assigned_user_id = $6,
         updated_at = $7
     where tenant_id = $8 and id = $9`,
    [
      stringInput(action.input.name, contact.name),
      stringInput(action.input.phone, contact.phone),
      stringInput(action.input.status, contact.status),
      stringInput(action.input.source, contact.source),
      toJson(tags),
      nullableStringInput(action.input.assignedUserId, contact.assigned_user_id),
      now,
      event.tenantId,
      contactId,
    ],
  );

  return {
    status: "succeeded",
    summary: "Contact mis a jour.",
    metadata: { contactId },
  };
}

async function addTagAction({
  db,
  event,
  action,
  now,
}: WorkflowActionContext): Promise<WorkflowActionResult> {
  const contactId = stringInput(action.input.contactId, event.payload.contactId);
  if (!contactId) {
    throw new WorkflowError(
      "workflow_action_failed",
      "Impossible d'ajouter un tag sans contact.",
    );
  }

  const current = await db.query<{ tags: string }>(
    "select tags from contacts where tenant_id = $1 and id = $2 limit 1",
    [event.tenantId, contactId],
  );
  const row = current.rows[0];

  if (!row) {
    throw new WorkflowError("workflow_action_failed", "Contact introuvable.");
  }

  const incoming = Array.isArray(action.input.tags)
    ? action.input.tags
    : [action.input.tag];
  const tags = normalizeTags([...safeJson<string[]>(row.tags, []), ...incoming]);

  await db.query(
    "update contacts set tags = $1, updated_at = $2 where tenant_id = $3 and id = $4",
    [toJson(tags), now, event.tenantId, contactId],
  );

  return {
    status: "succeeded",
    summary: "Tag ajoute au contact.",
    metadata: { contactId, tags },
  };
}

async function createActivityAction({
  db,
  runId,
  event,
  action,
  now,
}: WorkflowActionContext): Promise<WorkflowActionResult> {
  const targetType = stringInput(action.input.targetType, "workflow_run");
  const targetId = stringInput(action.input.targetId, runId);

  await db.query(
    "insert into activities (id, tenant_id, type, summary, target_type, target_id, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [
      id("activity"),
      event.tenantId,
      stringInput(action.input.type, "workflow.action"),
      stringInput(action.input.summary, "Action workflow executee."),
      targetType,
      targetId,
      now,
    ],
  );

  return {
    status: "succeeded",
    summary: "Activite creee.",
    metadata: { targetType, targetId },
  };
}

function sendMockNotificationAction(channel: string): WorkflowActionHandler {
  return async ({ db, event, action, now }) => {
    const recipientUserId = stringInput(
      action.input.recipientUserId,
      event.payload.ownerId,
    );

    if (!recipientUserId) {
      throw new WorkflowError(
        "workflow_action_failed",
        "Impossible d'envoyer la notification sans destinataire.",
      );
    }

    await db.query(
      "insert into notifications (id, tenant_id, channel, recipient_user_id, message, status, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
      [
        id("notification"),
        event.tenantId,
        channel,
        recipientUserId,
        stringInput(action.input.message, "Notification workflow mock envoyee."),
        "sent",
        now,
      ],
    );

    return {
      status: "succeeded",
      summary: "Notification mock envoyee.",
      metadata: { channel, recipientUserId },
    };
  };
}

async function callWebhookAction({
  db,
  runId,
  event,
  action,
  now,
}: WorkflowActionContext): Promise<WorkflowActionResult> {
  await db.query(
    "insert into activities (id, tenant_id, type, summary, target_type, target_id, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [
      id("activity"),
      event.tenantId,
      "workflow.webhook_mock",
      "Appel webhook simule par le moteur workflow.",
      "workflow_run",
      runId,
      now,
    ],
  );

  return {
    status: "succeeded",
    summary: "Webhook simule.",
    metadata: {
      urlConfigured:
        typeof action.input.url === "string" && action.input.url.length > 0,
    },
  };
}

async function waitForDurationAction({
  action,
  now,
}: WorkflowActionContext): Promise<WorkflowActionResult> {
  const durationMs = nonNegativeNumber(action.input.durationMs, 0);
  const resumeAt = new Date(new Date(now).getTime() + durationMs).toISOString();

  return {
    status: "waiting",
    summary: "Workflow mis en attente.",
    metadata: { durationMs, resumeAt },
    stop: true,
  };
}

async function requestApprovalAction({
  db,
  runId,
  event,
  definition,
  now,
}: WorkflowActionContext): Promise<WorkflowActionResult> {
  const approvalId = id("approval");
  await db.query(
    `insert into approvals (id, tenant_id, requested_by, policy, status, target_type, target_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      approvalId,
      event.tenantId,
      event.actorId,
      definition.approvalPolicy,
      "pending",
      "workflow_run",
      runId,
      now,
    ],
  );

  return {
    status: "approval_required",
    summary: "Workflow en attente d'approbation.",
    metadata: { approvalId },
    stop: true,
  };
}

function dueAtFromHours(value: unknown, fallbackHours: number) {
  const hours = nonNegativeNumber(value, fallbackHours);
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function stringInput(value: unknown, fallback: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (typeof fallback === "string" && fallback.trim()) {
    return fallback;
  }

  return "";
}

function nullableStringInput(value: unknown, fallback: string | null) {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  return fallback;
}

function nonNegativeNumber(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, value);
}

function normalizeTags(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}
