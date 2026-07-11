import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import {
  getPendingDomainEventCount,
  processPendingDomainEvents,
} from "../src/modules/workflows/worker";
import { getWorkflowDeadLetters } from "../src/modules/workflows";
import {
  parseWorkerConfig,
  runWorkerPoll,
  type WorkerLogEntry,
} from "../src/worker/runtime";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { db };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("workflow worker", () => {
  it("dispatches due pending domain events and marks them succeeded", async () => {
    const { db } = await setup();
    const now = new Date("2026-07-11T10:00:00.000Z");
    const handled: Array<Record<string, unknown>> = [];

    await insertDomainEvent(db, {
      id: "event_success",
      eventType: "test.event",
      payload: { value: 42 },
      nextRunAt: now.toISOString(),
    });

    const summary = await processPendingDomainEvents(db, {
      now,
      handlers: {
        "test.event": ({ event, attempt }) => {
          handled.push({ ...event.payload, attempt });
        },
      },
    });

    const event = await loadEvent(db, "event_success");

    expect(summary).toMatchObject({
      selected: 1,
      processed: 1,
      succeeded: 1,
      retried: 0,
      failed: 0,
    });
    expect(handled).toEqual([{ value: 42, attempt: 1 }]);
    expect(event.status).toBe("succeeded");
    expect(event.attempts).toBe(1);
    expect(event.last_error).toBeNull();
  });

  it("retries failed handlers with backoff before terminal failure", async () => {
    const { db } = await setup();
    const now = new Date("2026-07-11T10:00:00.000Z");
    const retryAt = new Date("2026-07-11T10:00:01.000Z");

    await insertDomainEvent(db, {
      id: "event_retry",
      eventType: "unstable.event",
      nextRunAt: now.toISOString(),
    });

    const first = await processPendingDomainEvents(db, {
      now,
      maxAttempts: 2,
      baseBackoffMs: 1_000,
      handlers: {
        "unstable.event": () => {
          throw new Error("Downstream unavailable.");
        },
      },
    });
    const afterFirstAttempt = await loadEvent(db, "event_retry");

    expect(first.retried).toBe(1);
    expect(afterFirstAttempt.status).toBe("pending");
    expect(afterFirstAttempt.attempts).toBe(1);
    expect(afterFirstAttempt.next_run_at).toBe(retryAt.toISOString());
    expect(await getPendingDomainEventCount(db, now)).toBe(0);

    const second = await processPendingDomainEvents(db, {
      now: retryAt,
      maxAttempts: 2,
      baseBackoffMs: 1_000,
      handlers: {
        "unstable.event": () => {
          throw new Error("Downstream unavailable.");
        },
      },
    });
    const afterSecondAttempt = await loadEvent(db, "event_retry");

    expect(second.failed).toBe(1);
    expect(afterSecondAttempt.status).toBe("failed");
    expect(afterSecondAttempt.attempts).toBe(2);
    expect(afterSecondAttempt.last_error).toBe("Downstream unavailable.");
  });

  it("requeues stale processing events before dispatching them", async () => {
    const { db } = await setup();
    const now = new Date("2026-07-11T10:00:00.000Z");

    await insertDomainEvent(db, {
      id: "event_stale",
      eventType: "stale.event",
      status: "processing",
      attempts: 1,
      nextRunAt: "2026-07-11T09:00:00.000Z",
      updatedAt: "2026-07-11T09:00:00.000Z",
    });

    const summary = await processPendingDomainEvents(db, {
      now,
      processingTimeoutMs: 60_000,
      handlers: {
        "stale.event": () => undefined,
      },
    });
    const event = await loadEvent(db, "event_stale");

    expect(summary.requeued).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(event.status).toBe("succeeded");
    expect(event.attempts).toBe(2);
  });

  it("polls repeated batches with structured heartbeat logs and bounded sleeps", async () => {
    const { db } = await setup();
    const logs: WorkerLogEntry[] = [];
    const sleeps: number[] = [];

    const result = await runWorkerPoll({
      db,
      batchSize: 3,
      pollIntervalMs: 250,
      maxIterations: 2,
      logger: (entry) => logs.push(entry),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result.iterations).toBe(2);
    expect(result.stoppedBy).toBe("max_iterations");
    expect(sleeps).toEqual([250]);
    expect(logs.map((entry) => entry.event)).toEqual([
      "worker.start",
      "worker.heartbeat",
      "worker.poll.completed",
      "worker.heartbeat",
      "worker.poll.completed",
      "worker.shutdown",
    ]);
    expect(logs.every((entry) => Boolean(entry.correlationId))).toBe(true);
  });

  it("stops polling gracefully after a shutdown signal", async () => {
    const { db } = await setup();
    const shutdown = new AbortController();

    const result = await runWorkerPoll({
      db,
      batchSize: 1,
      pollIntervalMs: 250,
      maxIterations: 5,
      signal: shutdown.signal,
      logger: () => undefined,
      sleep: async () => {
        shutdown.abort();
      },
    });

    expect(result.iterations).toBe(1);
    expect(result.stoppedBy).toBe("signal");
  });

  it("parses worker mode, batch size, and polling interval from environment", () => {
    expect(
      parseWorkerConfig({
        WORKER_MODE: "poll",
        WORKER_BATCH_SIZE: "7",
        WORKER_POLL_INTERVAL_MS: "1500",
      }),
    ).toEqual({ mode: "poll", batchSize: 7, pollIntervalMs: 1500 });
    expect(
      parseWorkerConfig({
        WORKER_MODE: "unsupported",
        WORKER_BATCH_SIZE: "oops",
        WORKER_POLL_INTERVAL_MS: "1",
      }),
    ).toEqual({ mode: "once", batchSize: 25, pollIntervalMs: 100 });
  });

  it("lists failed domain events as tenant-isolated dead letters", async () => {
    const { db } = await setup();
    await seedTenant(db, "tenant_dead_letters", "user_dead_letters");
    await seedTenant(db, "tenant_other_dead_letters", "user_other_dead_letters");
    await insertDomainEvent(db, {
      id: "event_dead_letter",
      tenantId: "tenant_dead_letters",
      eventType: "workflow.resume",
      status: "failed",
      attempts: 3,
      lastError: "Worker failed permanently. token=secret",
      nextRunAt: "2026-07-11T10:00:00.000Z",
    });
    await insertDomainEvent(db, {
      id: "event_other_dead_letter",
      tenantId: "tenant_other_dead_letters",
      eventType: "workflow.resume",
      status: "failed",
      attempts: 3,
      nextRunAt: "2026-07-11T10:00:00.000Z",
    });

    const deadLetters = await getWorkflowDeadLetters(
      db,
      "user_dead_letters",
      "tenant_dead_letters",
    );

    await expect(
      getWorkflowDeadLetters(
        db,
        "user_other_dead_letters",
        "tenant_dead_letters",
      ),
    ).rejects.toThrow("Acces refuse");

    expect(deadLetters).toEqual([
      expect.objectContaining({
        id: "event_dead_letter",
        tenantId: "tenant_dead_letters",
        eventType: "workflow.resume",
        attempts: 3,
        lastError: "Worker failed permanently. token=[redacted]",
      }),
    ]);
  });
});

async function insertDomainEvent(
  db: DbClient,
  overrides: {
    id: string;
    tenantId?: string;
    eventType: string;
    payload?: Record<string, unknown>;
    status?: string;
    attempts?: number;
    lastError?: string;
    nextRunAt?: string;
    updatedAt?: string;
  },
) {
  const createdAt = "2026-07-11T09:00:00.000Z";

  await db.query(
    `insert into domain_events (
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
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      overrides.id,
      overrides.tenantId ?? "tenant_worker",
      "system",
      overrides.eventType,
      JSON.stringify(overrides.payload ?? {}),
      overrides.status ?? "pending",
      overrides.attempts ?? 0,
      `${overrides.id}:idempotency`,
      `${overrides.id}:correlation`,
      null,
      overrides.nextRunAt ?? createdAt,
      overrides.status === "failed"
        ? overrides.lastError ?? "Worker failed permanently."
        : null,
      createdAt,
      overrides.updatedAt ?? createdAt,
    ],
  );
}

async function seedTenant(db: DbClient, tenantId: string, userId: string) {
  const now = "2026-07-11T09:00:00.000Z";
  await db.query(
    "insert into users (id, name, email, password_hash, created_at) values ($1, $2, $3, $4, $5)",
    [userId, userId, `${userId}@example.com`, "hash", now],
  );
  await db.query(
    "insert into tenants (id, name, slug, category, created_at) values ($1, $2, $3, $4, $5)",
    [tenantId, tenantId, tenantId.replaceAll("_", "-"), "Garage", now],
  );
  await db.query(
    "insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, $3, $4)",
    [tenantId, userId, "owner", now],
  );
}

async function loadEvent(db: DbClient, eventId: string) {
  const result = await db.query<{
    status: string;
    attempts: number;
    next_run_at: string;
    last_error: string | null;
  }>(
    "select status, attempts, next_run_at, last_error from domain_events where id = $1",
    [eventId],
  );

  return result.rows[0];
}
