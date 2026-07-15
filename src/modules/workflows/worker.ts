import type { DbClient } from "@/lib/db";
import { executeMockConnectorOperation } from "@/modules/connector-execution";
import {
  exportGenerationRequestedEventType,
  processUniversalExportJob,
} from "@/modules/exports";
import {
  dispatchQueuedNotification,
  notificationDispatchRequestedEventType,
} from "@/modules/notifications";
import {
  opportunityRadarSyncRequestedEventType,
  syncOpportunityRadarAlerts,
} from "@/modules/opportunity-radar";
import {
  leadCreatedEventType,
  processLeadFollowUpWorkflowEvent,
  resumeWorkflowRun,
  workflowResumeEventType,
} from "@/modules/workflows/engine";
import {
  dispatchWorkflowWebhook,
  type WorkflowWebhookFetch,
  workflowWebhookRequestedEventType,
} from "@/modules/workflows/webhook";

export type DomainEvent = {
  id: string;
  tenantId: string;
  actorId: string;
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  correlationId: string;
  causationId: string | null;
};

export type DomainEventHandler = (context: {
  db: DbClient;
  event: DomainEvent;
  attempt: number;
}) => Promise<void> | void;

export type DomainEventWorkerOptions = {
  limit?: number;
  now?: Date;
  maxAttempts?: number;
  baseBackoffMs?: number;
  processingTimeoutMs?: number;
  handlers?: Record<string, DomainEventHandler>;
  webhookFetch?: WorkflowWebhookFetch;
};

export type DomainEventWorkerSummary = {
  selected: number;
  processed: number;
  succeeded: number;
  retried: number;
  failed: number;
  skipped: number;
  requeued: number;
};

type DomainEventRow = {
  id: string;
  tenant_id: string;
  actor_id: string;
  event_type: string;
  payload: string;
  status: string;
  attempts: number;
  idempotency_key: string;
  correlation_id: string;
  causation_id: string | null;
  next_run_at: string;
  last_error: string | null;
  last_attempted_at: string | null;
  last_retry_delay_ms: number;
  failure_classification: string | null;
  max_attempts: number | null;
  created_at: string;
  updated_at: string;
};

const defaultLimit = 25;
const defaultMaxAttempts = 3;
const defaultBaseBackoffMs = 1_000;
const defaultProcessingTimeoutMs = 5 * 60 * 1_000;
const connectorSyncRequestedEventType = "connector.sync_requested";

const selectedColumns = `
  id,
  tenant_id,
  actor_id,
  event_type,
  payload,
  status,
  attempts,
  idempotency_key,
  correlation_id,
  causation_id,
  next_run_at,
  last_error,
  last_attempted_at,
  last_retry_delay_ms,
  failure_classification,
  max_attempts,
  created_at,
  updated_at
`;

export async function processPendingDomainEvents(
  db: DbClient,
  options: DomainEventWorkerOptions = {},
): Promise<DomainEventWorkerSummary> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const limit = positiveInteger(options.limit, defaultLimit);
  const maxAttempts = positiveInteger(options.maxAttempts, defaultMaxAttempts);
  const baseBackoffMs = nonNegativeInteger(
    options.baseBackoffMs,
    defaultBaseBackoffMs,
  );
  const processingTimeoutMs = nonNegativeInteger(
    options.processingTimeoutMs,
    defaultProcessingTimeoutMs,
  );
  const handlers: Record<string, DomainEventHandler> = {
    [workflowResumeEventType]: async ({ db: handlerDb, event }: {
      db: DbClient;
      event: DomainEvent;
    }) => {
      await resumeWorkflowRun(handlerDb, {
        ...event,
        causationId: event.causationId ?? undefined,
      });
    },
    [connectorSyncRequestedEventType]: async ({ db: handlerDb, event }) => {
      if (stringPayload(event.payload.connectorKey) !== "mock_business") {
        throw new Error("Unsupported connector sync request.");
      }
      const installationId = stringPayload(event.payload.installationId);
      if (!installationId) {
        throw new Error("Connector installation is required.");
      }
      const execution = await executeMockConnectorOperation(
        handlerDb,
        event.actorId,
        event.tenantId,
        {
          installationId,
          operation: "contacts.list",
          capability: "read",
          environment: "mock",
          idempotencyKey: event.idempotencyKey,
          correlationId: event.correlationId,
        },
      );
      if (execution.status !== "succeeded") {
        throw new Error(
          `Connector execution ${execution.safeErrorClassification ?? "failed"}.`,
        );
      }
    },
    [exportGenerationRequestedEventType]: async ({ db: handlerDb, event }) => {
      const exportId = stringPayload(event.payload.exportId);
      if (!exportId) throw new Error("Export identifier is required.");
      await processUniversalExportJob(
        handlerDb,
        event.actorId,
        event.tenantId,
        exportId,
      );
    },
    [leadCreatedEventType]: async ({ db: handlerDb, event }) => {
      await processLeadFollowUpWorkflowEvent(handlerDb, {
        ...event,
        causationId: event.causationId ?? undefined,
      });
    },
    [opportunityRadarSyncRequestedEventType]: async ({
      db: handlerDb,
      event,
    }) => {
      await syncOpportunityRadarAlerts(handlerDb, event.actorId, event.tenantId, {
        audit: true,
      });
    },
    [notificationDispatchRequestedEventType]: async ({
      db: handlerDb,
      event,
    }) => {
      await dispatchQueuedNotification(handlerDb, {
        tenantId: event.tenantId,
        actorId: event.actorId,
        payload: event.payload,
        correlationId: event.correlationId,
      });
    },
    [workflowWebhookRequestedEventType]: async ({ db: handlerDb, event }) => {
      await dispatchWorkflowWebhook(handlerDb, {
        tenantId: event.tenantId,
        actorId: event.actorId,
        eventId: event.id,
        idempotencyKey: event.idempotencyKey,
        correlationId: event.correlationId,
        payload: event.payload,
        fetchImpl: options.webhookFetch,
      });
    },
    ...(options.handlers ?? {}),
  };

  const summary: DomainEventWorkerSummary = {
    selected: 0,
    processed: 0,
    succeeded: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    requeued: 0,
  };

  summary.requeued = await requeueStaleProcessingEvents(
    db,
    now,
    processingTimeoutMs,
  );

  const pending = await db.query<DomainEventRow>(
    `select ${selectedColumns}
     from domain_events
     where status = $1 and next_run_at <= $2
     order by next_run_at asc, created_at asc
     limit ${limit}`,
    ["pending", nowIso],
  );

  summary.selected = pending.rows.length;

  for (const pendingEvent of pending.rows) {
    const claimed = await claimPendingEvent(db, pendingEvent.id, nowIso);

    if (!claimed) {
      summary.skipped += 1;
      continue;
    }

    summary.processed += 1;

    const handler = handlers[claimed.event_type];
    const attempt = Number(claimed.attempts);

    if (!handler) {
      await markFailed(
        db,
        claimed.id,
        nowIso,
        `No handler registered for domain event type "${claimed.event_type}".`,
        "handler_missing",
        1,
      );
      summary.failed += 1;
      continue;
    }

    try {
      await handler({
        db,
        event: toDomainEvent(claimed),
        attempt,
      });
      await markSucceeded(db, claimed.id, nowIso);
      summary.succeeded += 1;
    } catch (error) {
      const message = errorMessage(error);

      if (attempt >= maxAttempts) {
        await markFailed(
          db,
          claimed.id,
          nowIso,
          message,
          "max_attempts_exceeded",
          maxAttempts,
        );
        summary.failed += 1;
      } else {
        await markRetry(
          db,
          claimed.id,
          now,
          attempt,
          baseBackoffMs,
          maxAttempts,
          message,
        );
        summary.retried += 1;
      }
    }
  }

  return summary;
}

export async function getPendingDomainEventCount(
  db: DbClient,
  now = new Date(),
) {
  const result = await db.query<{ count: number | string }>(
    "select count(*)::int as count from domain_events where status = $1 and next_run_at <= $2",
    ["pending", now.toISOString()],
  );

  return Number(result.rows[0]?.count ?? 0);
}

async function requeueStaleProcessingEvents(
  db: DbClient,
  now: Date,
  processingTimeoutMs: number,
) {
  if (processingTimeoutMs === 0) {
    return 0;
  }

  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - processingTimeoutMs).toISOString();
  const result = await db.query<{ id: string }>(
    `update domain_events
     set status = $1,
         last_error = $2,
         failure_classification = $6,
         updated_at = $3
     where status = $4 and updated_at <= $5
     returning id`,
    [
      "pending",
      "Worker lease expired; event requeued.",
      nowIso,
      "processing",
      staleBefore,
      "worker_lease_expired",
    ],
  );

  return result.rows.length;
}

async function claimPendingEvent(
  db: DbClient,
  eventId: string,
  nowIso: string,
) {
  const result = await db.query<DomainEventRow>(
    `update domain_events
     set status = $1,
         attempts = attempts + 1,
         last_attempted_at = $2,
         failure_classification = null,
         updated_at = $2
     where id = $3 and status = $4
     returning ${selectedColumns}`,
    ["processing", nowIso, eventId, "pending"],
  );

  return result.rows[0] ?? null;
}

async function markSucceeded(db: DbClient, eventId: string, nowIso: string) {
  await db.query(
    `update domain_events
     set status = $1,
         last_error = null,
         last_retry_delay_ms = 0,
         failure_classification = null,
         max_attempts = null,
         updated_at = $2
     where id = $3`,
    ["succeeded", nowIso, eventId],
  );
}

async function markFailed(
  db: DbClient,
  eventId: string,
  nowIso: string,
  message: string,
  classification: string,
  maxAttempts: number,
) {
  await db.query(
    `update domain_events
     set status = $1,
         last_error = $2,
         last_retry_delay_ms = 0,
         failure_classification = $3,
         max_attempts = $4,
         updated_at = $5
     where id = $6`,
    ["failed", message, classification, maxAttempts, nowIso, eventId],
  );
}

async function markRetry(
  db: DbClient,
  eventId: string,
  now: Date,
  attempt: number,
  baseBackoffMs: number,
  maxAttempts: number,
  message: string,
) {
  const delayMs = baseBackoffMs * 2 ** Math.max(0, attempt - 1);
  const nextRunAt = new Date(now.getTime() + delayMs).toISOString();

  await db.query(
    `update domain_events
     set status = $1,
         last_error = $2,
         next_run_at = $3,
         last_retry_delay_ms = $4,
         failure_classification = $5,
         max_attempts = $6,
         updated_at = $7
     where id = $8`,
    [
      "pending",
      message,
      nextRunAt,
      delayMs,
      "transient_error",
      maxAttempts,
      now.toISOString(),
      eventId,
    ],
  );
}

function toDomainEvent(row: DomainEventRow): DomainEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    type: row.event_type,
    payload: parsePayload(row.payload),
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
  };
}

function parsePayload(value: string) {
  const parsed = JSON.parse(value) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Domain event payload must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Domain event handler failed.";
}

function stringPayload(value: unknown) {
  return typeof value === "string" ? value : "";
}

function positiveInteger(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function nonNegativeInteger(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.floor(value));
}
