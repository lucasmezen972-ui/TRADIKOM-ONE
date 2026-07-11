import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import {
  getPendingDomainEventCount,
  processPendingDomainEvents,
} from "../src/modules/workflows/worker";
import {
  getWorkflowDeadLetters,
  leadFollowUpWorkflow,
  retryWorkflowDeadLetter,
} from "../src/modules/workflows";
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
    expect(event.failure_classification).toBeNull();
    expect(event.last_retry_delay_ms).toBe(0);
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
    expect(afterFirstAttempt.last_attempted_at).toBe(now.toISOString());
    expect(afterFirstAttempt.last_retry_delay_ms).toBe(1_000);
    expect(afterFirstAttempt.failure_classification).toBe("transient_error");
    expect(afterFirstAttempt.max_attempts).toBe(2);
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
    expect(afterSecondAttempt.last_retry_delay_ms).toBe(0);
    expect(afterSecondAttempt.failure_classification).toBe(
      "max_attempts_exceeded",
    );
    expect(afterSecondAttempt.max_attempts).toBe(2);
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

  it("dispatches connector sync requests through a domain-specific handler", async () => {
    const { db } = await setup();
    await seedTenant(db, "tenant_connector_worker", "user_connector_worker");
    await seedMockConnector(db, "tenant_connector_worker");
    await insertDomainEvent(db, {
      id: "event_connector_sync",
      tenantId: "tenant_connector_worker",
      eventType: "connector.sync_requested",
      payload: { connectorKey: "mock_business" },
      nextRunAt: "2026-07-11T10:00:00.000Z",
    });

    const summary = await processPendingDomainEvents(db, {
      now: new Date("2026-07-11T10:00:00.000Z"),
    });
    const connector = await loadMockConnector(db, "tenant_connector_worker");

    expect(summary.succeeded).toBe(1);
    expect(connector).toEqual({ status: "Connecté", health: "healthy" });
    expect(await countConnectorSyncRuns(db, "tenant_connector_worker")).toBe(1);
    expect(await countConnectorSyncAudits(db, "tenant_connector_worker")).toBe(1);
  });

  it("dispatches lead workflow events through the durable worker", async () => {
    const { db } = await setup();
    await seedTenant(db, "tenant_lead_worker", "user_lead_worker");
    await seedLeadFollowUpWorkflow(db, "tenant_lead_worker");
    await seedLeadForWorkflow(db, {
      tenantId: "tenant_lead_worker",
      userId: "user_lead_worker",
      contactId: "contact_lead_worker",
      leadId: "lead_worker",
    });
    await insertDomainEvent(db, {
      id: "event_lead_created",
      tenantId: "tenant_lead_worker",
      eventType: "lead.created",
      payload: {
        leadId: "lead_worker",
        contactId: "contact_lead_worker",
        ownerId: "user_lead_worker",
        source: "website",
      },
      nextRunAt: "2026-07-11T10:00:00.000Z",
    });

    const summary = await processPendingDomainEvents(db, {
      now: new Date("2026-07-11T10:00:00.000Z"),
    });
    const event = await loadEvent(db, "event_lead_created");

    expect(summary.succeeded).toBe(1);
    expect(event.status).toBe("succeeded");
    expect(await countLeadWorkflowRuns(db, "tenant_lead_worker")).toBe(1);
    expect(await countLeadWorkflowTasks(db, "tenant_lead_worker")).toBe(1);
    expect(await countWorkflowExecutedAudits(db, "tenant_lead_worker")).toBe(1);
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

  it("requeues failed domain events with tenant authorization and audit", async () => {
    const { db } = await setup();
    await seedTenant(db, "tenant_requeue_dead_letter", "user_requeue_dead_letter");
    await seedTenant(
      db,
      "tenant_other_requeue_dead_letter",
      "user_other_requeue_dead_letter",
    );
    await insertDomainEvent(db, {
      id: "event_requeue_dead_letter",
      tenantId: "tenant_requeue_dead_letter",
      eventType: "workflow.resume",
      status: "failed",
      attempts: 3,
      lastError: "Worker failed permanently.",
      nextRunAt: "2026-07-11T10:00:00.000Z",
    });

    await expect(
      retryWorkflowDeadLetter(
        db,
        "user_other_requeue_dead_letter",
        "tenant_requeue_dead_letter",
        { eventId: "event_requeue_dead_letter" },
      ),
    ).rejects.toThrow("Acces refuse");

    await retryWorkflowDeadLetter(
      db,
      "user_requeue_dead_letter",
      "tenant_requeue_dead_letter",
      { eventId: "event_requeue_dead_letter" },
    );
    const event = await loadEvent(db, "event_requeue_dead_letter");

    expect(event.status).toBe("pending");
    expect(event.attempts).toBe(0);
    expect(event.last_error).toBeNull();
    expect(event.last_attempted_at).toBeNull();
    expect(event.last_retry_delay_ms).toBe(0);
    expect(event.failure_classification).toBeNull();
    expect(event.max_attempts).toBeNull();
    expect(await countDeadLetterRetryAudits(db, "tenant_requeue_dead_letter")).toBe(
      1,
    );
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

async function seedMockConnector(db: DbClient, tenantId: string) {
  const now = "2026-07-11T09:00:00.000Z";
  await db.query(
    `insert into connectors (
       id,
       tenant_id,
       connector_key,
       status,
       health,
       safe_config,
       last_sync_at,
       created_at,
       updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      "connector_worker_mock",
      tenantId,
      "mock_business",
      "Configuration requise",
      "warning",
      "{}",
      null,
      now,
      now,
    ],
  );
}

async function seedLeadFollowUpWorkflow(db: DbClient, tenantId: string) {
  await db.query(
    `insert into workflows (
       id,
       tenant_id,
       workflow_key,
       name,
       trigger_name,
       status,
       approval_policy,
       definition,
       created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      `workflow_${tenantId}`,
      tenantId,
      leadFollowUpWorkflow.key,
      "Suivi automatique des nouveaux leads site",
      leadFollowUpWorkflow.trigger,
      "active",
      leadFollowUpWorkflow.approvalPolicy,
      JSON.stringify(leadFollowUpWorkflow),
      "2026-07-11T09:00:00.000Z",
    ],
  );
}

async function seedLeadForWorkflow(
  db: DbClient,
  input: {
    tenantId: string;
    userId: string;
    contactId: string;
    leadId: string;
  },
) {
  const now = "2026-07-11T09:00:00.000Z";
  await db.query(
    `insert into contacts (
       id,
       tenant_id,
       name,
       email,
       phone,
       status,
       source,
       tags,
       assigned_user_id,
       created_at,
       updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.contactId,
      input.tenantId,
      "Client Worker",
      "client.worker@example.com",
      "+596 696 00 00 00",
      "Nouveau",
      "website",
      JSON.stringify(["website"]),
      input.userId,
      now,
      now,
    ],
  );
  await db.query(
    `insert into leads (
       id,
       tenant_id,
       contact_id,
       source,
       status,
       opportunity_value,
       page_path,
       created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.leadId,
      input.tenantId,
      input.contactId,
      "website",
      "Nouveau contact",
      0,
      "/sites/worker",
      now,
    ],
  );
}

async function loadEvent(db: DbClient, eventId: string) {
  const result = await db.query<{
    status: string;
    attempts: number;
    next_run_at: string;
    last_error: string | null;
    last_attempted_at: string | null;
    last_retry_delay_ms: number;
    failure_classification: string | null;
    max_attempts: number | null;
  }>(
    `select status,
            attempts,
            next_run_at,
            last_error,
            last_attempted_at,
            last_retry_delay_ms,
            failure_classification,
            max_attempts
     from domain_events
     where id = $1`,
    [eventId],
  );

  return result.rows[0];
}

async function countDeadLetterRetryAudits(db: DbClient, tenantId: string) {
  const result = await db.query<{ count: number | string }>(
    "select count(*)::int as count from audit_logs where tenant_id = $1 and action = $2",
    [tenantId, "workflow.dead_letter_retried"],
  );

  return Number(result.rows[0]?.count ?? 0);
}

async function loadMockConnector(db: DbClient, tenantId: string) {
  const result = await db.query<{ status: string; health: string }>(
    "select status, health from connectors where tenant_id = $1 and connector_key = $2",
    [tenantId, "mock_business"],
  );

  return result.rows[0];
}

async function countConnectorSyncRuns(db: DbClient, tenantId: string) {
  const result = await db.query<{ count: number | string }>(
    "select count(*)::int as count from connector_sync_runs where tenant_id = $1 and connector_key = $2",
    [tenantId, "mock_business"],
  );

  return Number(result.rows[0]?.count ?? 0);
}

async function countConnectorSyncAudits(db: DbClient, tenantId: string) {
  const result = await db.query<{ count: number | string }>(
    "select count(*)::int as count from audit_logs where tenant_id = $1 and action = $2",
    [tenantId, "connector.sync_completed"],
  );

  return Number(result.rows[0]?.count ?? 0);
}

async function countLeadWorkflowRuns(db: DbClient, tenantId: string) {
  const result = await db.query<{ count: number | string }>(
    "select count(*)::int as count from workflow_runs where tenant_id = $1 and workflow_key = $2 and status = $3",
    [tenantId, leadFollowUpWorkflow.key, "succeeded"],
  );

  return Number(result.rows[0]?.count ?? 0);
}

async function countLeadWorkflowTasks(db: DbClient, tenantId: string) {
  const result = await db.query<{ count: number | string }>(
    "select count(*)::int as count from tasks where tenant_id = $1 and title like $2",
    [tenantId, "Relancer%"],
  );

  return Number(result.rows[0]?.count ?? 0);
}

async function countWorkflowExecutedAudits(db: DbClient, tenantId: string) {
  const result = await db.query<{ count: number | string }>(
    "select count(*)::int as count from audit_logs where tenant_id = $1 and action = $2",
    [tenantId, "workflow.executed"],
  );

  return Number(result.rows[0]?.count ?? 0);
}
