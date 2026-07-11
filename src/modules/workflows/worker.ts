import type { DbClient } from "@/lib/db";
import {
  resumeWorkflowRun,
  workflowResumeEventType,
} from "@/modules/workflows/engine";

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
  created_at: string;
  updated_at: string;
};

const defaultLimit = 25;
const defaultMaxAttempts = 3;
const defaultBaseBackoffMs = 1_000;
const defaultProcessingTimeoutMs = 5 * 60 * 1_000;

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
        await markFailed(db, claimed.id, nowIso, message);
        summary.failed += 1;
      } else {
        await markRetry(db, claimed.id, now, attempt, baseBackoffMs, message);
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
     set status = $1, last_error = $2, updated_at = $3
     where status = $4 and updated_at <= $5
     returning id`,
    [
      "pending",
      "Worker lease expired; event requeued.",
      nowIso,
      "processing",
      staleBefore,
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
     set status = $1, attempts = attempts + 1, updated_at = $2
     where id = $3 and status = $4
     returning ${selectedColumns}`,
    ["processing", nowIso, eventId, "pending"],
  );

  return result.rows[0] ?? null;
}

async function markSucceeded(db: DbClient, eventId: string, nowIso: string) {
  await db.query(
    "update domain_events set status = $1, last_error = $2, updated_at = $3 where id = $4",
    ["succeeded", null, nowIso, eventId],
  );
}

async function markFailed(
  db: DbClient,
  eventId: string,
  nowIso: string,
  message: string,
) {
  await db.query(
    "update domain_events set status = $1, last_error = $2, updated_at = $3 where id = $4",
    ["failed", message, nowIso, eventId],
  );
}

async function markRetry(
  db: DbClient,
  eventId: string,
  now: Date,
  attempt: number,
  baseBackoffMs: number,
  message: string,
) {
  const delayMs = baseBackoffMs * 2 ** Math.max(0, attempt - 1);
  const nextRunAt = new Date(now.getTime() + delayMs).toISOString();

  await db.query(
    "update domain_events set status = $1, last_error = $2, next_run_at = $3, updated_at = $4 where id = $5",
    ["pending", message, nextRunAt, now.toISOString(), eventId],
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
