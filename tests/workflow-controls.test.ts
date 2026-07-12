import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import {
  approveWorkflowRun,
  cancelWorkflowRun,
  getWorkflowQueueOverview,
  rejectWorkflowRun,
  requestManualWorkflowRetry,
} from "../src/modules/workflows";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  await seedTenant(db, "tenant_controls", "user_controls");
  await seedTenant(db, "tenant_other_controls", "user_other_controls");
  return { db };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("workflow controls", () => {
  it("approves, rejects, cancels, retries, and keeps tenant isolation", async () => {
    const { db } = await setup();
    await seedRun(db, "tenant_controls", "run_approval", "approval_required");
    await seedApproval(db, "tenant_controls", "approval_run", "run_approval");
    await seedRun(db, "tenant_controls", "run_reject", "approval_required");
    await seedApproval(db, "tenant_controls", "approval_reject", "run_reject");
    await seedRun(db, "tenant_controls", "run_cancel", "waiting");
    await seedRun(db, "tenant_controls", "run_retry", "failed");

    await approveWorkflowRun(db, "user_controls", "tenant_controls", {
      runId: "run_approval",
    });
    await rejectWorkflowRun(db, "user_controls", "tenant_controls", {
      runId: "run_reject",
    });
    await cancelWorkflowRun(db, "user_controls", "tenant_controls", {
      runId: "run_cancel",
    });
    await requestManualWorkflowRetry(db, "user_controls", "tenant_controls", {
      runId: "run_retry",
    });

    await expect(
      cancelWorkflowRun(db, "user_other_controls", "tenant_controls", {
        runId: "run_retry",
      }),
    ).rejects.toThrow("Acces refuse");

    expect(await loadRunStatus(db, "tenant_controls", "run_approval")).toBe(
      "waiting",
    );
    expect(await loadApprovalStatus(db, "tenant_controls", "approval_run")).toBe(
      "approved",
    );
    expect(await loadRunStatus(db, "tenant_controls", "run_reject")).toBe(
      "rejected",
    );
    expect(await loadApprovalStatus(db, "tenant_controls", "approval_reject")).toBe(
      "rejected",
    );
    expect(await loadRunStatus(db, "tenant_controls", "run_cancel")).toBe(
      "cancelled",
    );
    expect(await loadRunStatus(db, "tenant_controls", "run_retry")).toBe(
      "waiting",
    );
    expect(await countWorkflowSteps(db, "tenant_controls")).toBe(4);
    expect(await countAuditLogs(db, "tenant_controls")).toBe(4);
  });

  it("exposes tenant-scoped workflow queue health", async () => {
    const { db } = await setup();
    await seedDomainEvent(db, {
      id: "event_pending_controls",
      tenantId: "tenant_controls",
      eventType: "lead.created",
      status: "pending",
      nextRunAt: "2026-07-11T14:31:00.000Z",
    });
    await seedDomainEvent(db, {
      id: "event_processing_controls",
      tenantId: "tenant_controls",
      eventType: "workflow.resume",
      status: "processing",
      attempts: 1,
      nextRunAt: "2026-07-11T14:32:00.000Z",
    });
    await seedDomainEvent(db, {
      id: "event_failed_controls",
      tenantId: "tenant_controls",
      eventType: "connector.sync_requested",
      status: "failed",
      attempts: 3,
      nextRunAt: "2026-07-11T14:33:00.000Z",
    });
    await seedDomainEvent(db, {
      id: "event_other_controls",
      tenantId: "tenant_other_controls",
      eventType: "lead.created",
      status: "pending",
      nextRunAt: "2026-07-11T14:34:00.000Z",
    });

    const overview = await getWorkflowQueueOverview(
      db,
      "user_controls",
      "tenant_controls",
    );

    await expect(
      getWorkflowQueueOverview(db, "user_other_controls", "tenant_controls"),
    ).rejects.toThrow("Acces refuse");

    expect(statusCount(overview.summary, "pending")).toBe(1);
    expect(statusCount(overview.summary, "processing")).toBe(1);
    expect(statusCount(overview.summary, "failed")).toBe(1);
    expect(overview.activeEvents.map((event) => event.id)).toEqual([
      "event_pending_controls",
      "event_processing_controls",
    ]);
    expect(
      overview.activeEvents.every((event) => event.tenantId === "tenant_controls"),
    ).toBe(true);
  });
});

async function seedTenant(db: DbClient, tenantId: string, userId: string) {
  const now = "2026-07-11T14:30:00.000Z";
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

async function seedRun(
  db: DbClient,
  tenantId: string,
  runId: string,
  status: string,
) {
  await db.query(
    `insert into workflow_runs (id, tenant_id, workflow_key, trigger_name, status, summary, error, retry_count, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      runId,
      tenantId,
      "new_website_lead_follow_up",
      "lead.created",
      status,
      "Workflow de test.",
      status === "failed" ? "Failure" : null,
      0,
      "2026-07-11T14:30:00.000Z",
    ],
  );
}

async function seedApproval(
  db: DbClient,
  tenantId: string,
  approvalId: string,
  runId: string,
) {
  await db.query(
    `insert into approvals (id, tenant_id, requested_by, policy, status, target_type, target_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      approvalId,
      tenantId,
      "system",
      "user_approval_required",
      "pending",
      "workflow_run",
      runId,
      "2026-07-11T14:30:00.000Z",
    ],
  );
}

async function seedDomainEvent(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    eventType: string;
    status: string;
    nextRunAt: string;
    attempts?: number;
  },
) {
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
      input.id,
      input.tenantId,
      "system",
      input.eventType,
      "{}",
      input.status,
      input.attempts ?? 0,
      `${input.id}:idempotency`,
      `${input.id}:correlation`,
      null,
      input.nextRunAt,
      input.status === "failed" ? "Failure" : null,
      "2026-07-11T14:30:00.000Z",
      input.nextRunAt,
    ],
  );
}

async function loadRunStatus(db: DbClient, tenantId: string, runId: string) {
  const result = await db.query<{ status: string }>(
    "select status from workflow_runs where tenant_id = $1 and id = $2",
    [tenantId, runId],
  );

  return result.rows[0]?.status;
}

async function loadApprovalStatus(
  db: DbClient,
  tenantId: string,
  approvalId: string,
) {
  const result = await db.query<{ status: string }>(
    "select status from approvals where tenant_id = $1 and id = $2",
    [tenantId, approvalId],
  );

  return result.rows[0]?.status;
}

async function countWorkflowSteps(db: DbClient, tenantId: string) {
  const result = await db.query<{ count: number }>(
    "select count(*)::int as count from workflow_run_steps where tenant_id = $1",
    [tenantId],
  );

  return Number(result.rows[0]?.count ?? 0);
}

async function countAuditLogs(db: DbClient, tenantId: string) {
  const result = await db.query<{ count: number }>(
    "select count(*)::int as count from audit_logs where tenant_id = $1 and action like $2",
    [tenantId, "workflow.%"],
  );

  return Number(result.rows[0]?.count ?? 0);
}

function statusCount(
  summary: Array<{ status: string; count: number }>,
  status: string,
) {
  return summary.find((item) => item.status === status)?.count ?? 0;
}
