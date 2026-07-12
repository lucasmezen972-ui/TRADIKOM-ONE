import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { toJson } from "../src/lib/security";
import {
  executeLeadFollowUpWorkflow,
  leadFollowUpWorkflow,
  workflowDefinitionSchema,
  type WorkflowDefinition,
} from "../src/modules/workflows";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { db };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("workflow engine", () => {
  it("executes the tenant persisted lead workflow and skips replayed events", async () => {
    const { db } = await setup();
    await seedTenant(db, {
      tenantId: "tenant_workflow_a",
      ownerId: "user_workflow_a",
      workflowDefinition: workflowDefinitionSchema.parse({
        ...leadFollowUpWorkflow,
        version: 2,
        conditions: ["payload.source == website"],
        actions: [
          {
            type: "create_task",
            input: { title: "Relance persistante sous 2h", dueInHours: 2 },
          },
          { type: "add_tag", input: { tag: "workflow-persisted" } },
          {
            type: "send_mock_email",
            input: { message: "Definition persistante executee." },
          },
          {
            type: "create_activity",
            input: { summary: "Workflow persistant execute." },
          },
        ],
      }),
    });
    await seedTenant(db, {
      tenantId: "tenant_workflow_b",
      ownerId: "user_workflow_b",
      workflowDefinition: leadFollowUpWorkflow,
    });

    await seedLead(db, {
      tenantId: "tenant_workflow_a",
      contactId: "contact_workflow_a",
      leadId: "lead_workflow_a",
      ownerId: "user_workflow_a",
    });
    await seedLead(db, {
      tenantId: "tenant_workflow_b",
      contactId: "contact_workflow_b",
      leadId: "lead_workflow_b",
      ownerId: "user_workflow_b",
    });

    await executeLeadFollowUpWorkflow(db, {
      tenantId: "tenant_workflow_a",
      leadId: "lead_workflow_a",
      contactId: "contact_workflow_a",
      ownerId: "user_workflow_a",
      source: "website",
      correlationId: "corr_workflow_a",
    });
    await executeLeadFollowUpWorkflow(db, {
      tenantId: "tenant_workflow_b",
      leadId: "lead_workflow_b",
      contactId: "contact_workflow_b",
      ownerId: "user_workflow_b",
      source: "website",
      correlationId: "corr_workflow_b",
    });

    const replayedRun = await executeLeadFollowUpWorkflow(db, {
      tenantId: "tenant_workflow_a",
      leadId: "lead_workflow_a",
      contactId: "contact_workflow_a",
      ownerId: "user_workflow_a",
      source: "website",
      correlationId: "corr_workflow_replay",
    });

    const contactA = await loadContactTags(db, "tenant_workflow_a");
    const contactB = await loadContactTags(db, "tenant_workflow_b");
    const taskCount = await countRows(
      db,
      "tasks",
      "tenant_id = $1 and title = $2",
      ["tenant_workflow_a", "Relance persistante sous 2h"],
    );
    const runCount = await countRows(db, "workflow_runs", "tenant_id = $1", [
      "tenant_workflow_a",
    ]);
    const orderedSteps = await loadOrderedSteps(db, "tenant_workflow_a");

    expect(replayedRun).toBeNull();
    expect(contactA).toEqual(
      expect.arrayContaining(["website", "workflow-persisted"]),
    );
    expect(contactB).not.toContain("workflow-persisted");
    expect(taskCount).toBe(1);
    expect(runCount).toBe(1);
    expect(orderedSteps).toEqual([
      { action_name: "create_task", status: "succeeded", attempts: 1 },
      { action_name: "add_tag", status: "succeeded", attempts: 1 },
      { action_name: "send_mock_email", status: "succeeded", attempts: 1 },
      { action_name: "create_activity", status: "succeeded", attempts: 1 },
    ]);
    expect(await countIncompleteStepAttempts(db, "tenant_workflow_a")).toBe(0);
  });

  it("records approval-required workflow runs without executing later actions", async () => {
    const { db } = await setup();
    await seedTenant(db, {
      tenantId: "tenant_workflow_approval",
      ownerId: "user_workflow_approval",
      workflowDefinition: workflowDefinitionSchema.parse({
        ...leadFollowUpWorkflow,
        version: 3,
        approvalPolicy: "user_approval_required",
        actions: [
          { type: "request_approval", input: {} },
          { type: "create_task", input: { title: "Ne doit pas etre creee" } },
        ],
      }),
    });
    await seedLead(db, {
      tenantId: "tenant_workflow_approval",
      contactId: "contact_workflow_approval",
      leadId: "lead_workflow_approval",
      ownerId: "user_workflow_approval",
    });

    await executeLeadFollowUpWorkflow(db, {
      tenantId: "tenant_workflow_approval",
      leadId: "lead_workflow_approval",
      contactId: "contact_workflow_approval",
      ownerId: "user_workflow_approval",
      source: "website",
      correlationId: "corr_workflow_approval",
    });

    const run = await db.query<{ status: string }>(
      "select status from workflow_runs where tenant_id = $1 limit 1",
      ["tenant_workflow_approval"],
    );
    const approvals = await countRows(
      db,
      "approvals",
      "tenant_id = $1 and status = $2",
      ["tenant_workflow_approval", "pending"],
    );
    const blockedTasks = await countRows(
      db,
      "tasks",
      "tenant_id = $1 and title = $2",
      ["tenant_workflow_approval", "Ne doit pas etre creee"],
    );

    expect(run.rows[0]?.status).toBe("approval_required");
    expect(approvals).toBe(1);
    expect(blockedTasks).toBe(0);
  });
});

async function seedTenant(
  db: DbClient,
  input: {
    tenantId: string;
    ownerId: string;
    workflowDefinition: WorkflowDefinition;
  },
) {
  const now = "2026-07-11T14:00:00.000Z";
  await db.query(
    "insert into users (id, name, email, password_hash, created_at) values ($1, $2, $3, $4, $5)",
    [
      input.ownerId,
      input.ownerId,
      `${input.ownerId}@example.com`,
      "hash",
      now,
    ],
  );
  await db.query(
    "insert into tenants (id, name, slug, category, created_at) values ($1, $2, $3, $4, $5)",
    [
      input.tenantId,
      input.tenantId,
      input.tenantId.replaceAll("_", "-"),
      "Garage automobile",
      now,
    ],
  );
  await db.query(
    "insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, $3, $4)",
    [input.tenantId, input.ownerId, "owner", now],
  );
  await db.query(
    `insert into workflows (id, tenant_id, workflow_key, name, trigger_name, status, approval_policy, definition, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      `workflow_${input.tenantId}`,
      input.tenantId,
      input.workflowDefinition.key,
      "Suivi automatique des nouveaux leads site",
      input.workflowDefinition.trigger,
      "active",
      input.workflowDefinition.approvalPolicy,
      toJson(input.workflowDefinition),
      now,
    ],
  );
}

async function seedLead(
  db: DbClient,
  input: {
    tenantId: string;
    contactId: string;
    leadId: string;
    ownerId: string;
  },
) {
  const now = "2026-07-11T14:00:00.000Z";
  await db.query(
    `insert into contacts (id, tenant_id, name, email, phone, status, source, tags, assigned_user_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.contactId,
      input.tenantId,
      input.contactId,
      `${input.contactId}@example.com`,
      "+596 696 00 00 00",
      "Nouveau",
      "website",
      toJson(["website"]),
      input.ownerId,
      now,
      now,
    ],
  );
  await db.query(
    `insert into leads (id, tenant_id, contact_id, source, status, opportunity_value, page_path, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.leadId,
      input.tenantId,
      input.contactId,
      "website",
      "Nouveau contact",
      0,
      "/sites/workflow",
      now,
    ],
  );
}

async function loadContactTags(db: DbClient, tenantId: string) {
  const result = await db.query<{ tags: string }>(
    "select tags from contacts where tenant_id = $1 limit 1",
    [tenantId],
  );

  return JSON.parse(result.rows[0]?.tags ?? "[]") as string[];
}

async function loadOrderedSteps(db: DbClient, tenantId: string) {
  const steps = await db.query<{
    action_name: string;
    status: string;
    attempts: number;
    safe_metadata: string;
    started_at: string | null;
    completed_at: string | null;
  }>(
    `select action_name, status, attempts, safe_metadata, started_at, completed_at
     from workflow_run_steps
     where tenant_id = $1`,
    [tenantId],
  );

  return steps.rows
    .map((step) => ({
      action_name: step.action_name,
      status: step.status,
      attempts: Number(step.attempts),
      actionIndex: Number(JSON.parse(step.safe_metadata).actionIndex),
      started: Boolean(step.started_at),
      completed: Boolean(step.completed_at),
    }))
    .sort((left, right) => left.actionIndex - right.actionIndex)
    .map(({ action_name, status, attempts }) => ({
      action_name,
      status,
      attempts,
    }));
}

async function countIncompleteStepAttempts(db: DbClient, tenantId: string) {
  const result = await db.query<{ count: number }>(
    `select count(*)::int as count
     from workflow_run_steps
     where tenant_id = $1
       and (started_at is null or completed_at is null or attempts < 1)`,
    [tenantId],
  );

  return Number(result.rows[0]?.count ?? 0);
}

async function countRows(
  db: DbClient,
  tableName: string,
  whereClause: string,
  params: unknown[],
) {
  const result = await db.query<{ count: number }>(
    `select count(*)::int as count from ${tableName} where ${whereClause}`,
    params,
  );

  return Number(result.rows[0]?.count ?? 0);
}
