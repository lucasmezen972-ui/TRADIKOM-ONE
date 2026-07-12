import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { toJson } from "../src/lib/security";
import {
  approveWorkflowRun,
  cancelWorkflowRun,
  executeLeadFollowUpWorkflow,
  leadFollowUpWorkflow,
  requestManualWorkflowRetry,
  workflowDefinitionSchema,
  type WorkflowDefinition,
} from "../src/modules/workflows";
import { processPendingDomainEvents } from "../src/modules/workflows/worker";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { db };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("workflow resume", () => {
  it("resumes delayed workflow actions through the worker", async () => {
    const { db } = await setup();
    await seedTenant(db, {
      tenantId: "tenant_resume_wait",
      ownerId: "user_resume_wait",
      workflowDefinition: workflowDefinitionSchema.parse({
        ...leadFollowUpWorkflow,
        version: 4,
        actions: [
          { type: "wait_for_duration", input: { durationMs: 0 } },
          { type: "create_task", input: { title: "Relance apres attente" } },
        ],
      }),
    });
    await seedLead(db, {
      tenantId: "tenant_resume_wait",
      contactId: "contact_resume_wait",
      leadId: "lead_resume_wait",
      ownerId: "user_resume_wait",
    });

    await executeLeadFollowUpWorkflow(db, {
      tenantId: "tenant_resume_wait",
      leadId: "lead_resume_wait",
      contactId: "contact_resume_wait",
      ownerId: "user_resume_wait",
      source: "website",
      correlationId: "corr_resume_wait",
    });

    expect(await loadRunStatus(db, "tenant_resume_wait")).toBe("waiting");
    expect(
      await countRows(db, "tasks", "tenant_id = $1 and title = $2", [
        "tenant_resume_wait",
        "Relance apres attente",
      ]),
    ).toBe(0);

    const summary = await processPendingDomainEvents(db, {
      now: new Date("2999-01-01T00:00:00.000Z"),
    });

    expect(summary.succeeded).toBe(1);
    expect(await loadRunStatus(db, "tenant_resume_wait")).toBe("succeeded");
    expect(
      await countRows(db, "tasks", "tenant_id = $1 and title = $2", [
        "tenant_resume_wait",
        "Relance apres attente",
      ]),
    ).toBe(1);
  });

  it("resumes approved workflow runs through the worker", async () => {
    const { db } = await setup();
    await seedTenant(db, {
      tenantId: "tenant_resume_approval",
      ownerId: "user_resume_approval",
      workflowDefinition: workflowDefinitionSchema.parse({
        ...leadFollowUpWorkflow,
        version: 5,
        approvalPolicy: "user_approval_required",
        actions: [
          { type: "request_approval", input: {} },
          { type: "create_task", input: { title: "Relance approuvee" } },
        ],
      }),
    });
    await seedLead(db, {
      tenantId: "tenant_resume_approval",
      contactId: "contact_resume_approval",
      leadId: "lead_resume_approval",
      ownerId: "user_resume_approval",
    });

    const runId = await executeLeadFollowUpWorkflow(db, {
      tenantId: "tenant_resume_approval",
      leadId: "lead_resume_approval",
      contactId: "contact_resume_approval",
      ownerId: "user_resume_approval",
      source: "website",
      correlationId: "corr_resume_approval",
    });

    expect(await loadRunStatus(db, "tenant_resume_approval")).toBe(
      "approval_required",
    );

    await approveWorkflowRun(db, "user_resume_approval", "tenant_resume_approval", {
      runId: runId ?? "",
    });
    const summary = await processPendingDomainEvents(db, {
      now: new Date("2999-01-01T00:00:00.000Z"),
    });

    expect(summary.succeeded).toBe(1);
    expect(await loadRunStatus(db, "tenant_resume_approval")).toBe("succeeded");
    expect(await loadApprovalStatus(db, "tenant_resume_approval")).toBe(
      "approved",
    );
    expect(
      await countRows(db, "tasks", "tenant_id = $1 and title = $2", [
        "tenant_resume_approval",
        "Relance approuvee",
      ]),
    ).toBe(1);
  });

  it("does not resume a cancelled waiting workflow", async () => {
    const { db } = await setup();
    await seedTenant(db, {
      tenantId: "tenant_resume_cancel",
      ownerId: "user_resume_cancel",
      workflowDefinition: workflowDefinitionSchema.parse({
        ...leadFollowUpWorkflow,
        version: 6,
        actions: [
          { type: "wait_for_duration", input: { durationMs: 0 } },
          { type: "create_task", input: { title: "Relance annulee" } },
        ],
      }),
    });
    await seedLead(db, {
      tenantId: "tenant_resume_cancel",
      contactId: "contact_resume_cancel",
      leadId: "lead_resume_cancel",
      ownerId: "user_resume_cancel",
    });

    const runId = await executeLeadFollowUpWorkflow(db, {
      tenantId: "tenant_resume_cancel",
      leadId: "lead_resume_cancel",
      contactId: "contact_resume_cancel",
      ownerId: "user_resume_cancel",
      source: "website",
      correlationId: "corr_resume_cancel",
    });

    await cancelWorkflowRun(db, "user_resume_cancel", "tenant_resume_cancel", {
      runId: runId ?? "",
    });
    await processPendingDomainEvents(db, {
      now: new Date("2999-01-01T00:00:00.000Z"),
    });

    expect(await loadRunStatus(db, "tenant_resume_cancel")).toBe("cancelled");
    expect(
      await countRows(db, "tasks", "tenant_id = $1 and title = $2", [
        "tenant_resume_cancel",
        "Relance annulee",
      ]),
    ).toBe(0);
  });

  it("replays a failed action on manual retry", async () => {
    const { db } = await setup();
    await seedTenant(db, {
      tenantId: "tenant_resume_retry",
      ownerId: "user_resume_retry",
      workflowDefinition: workflowDefinitionSchema.parse({
        ...leadFollowUpWorkflow,
        version: 7,
        actions: [
          {
            type: "update_contact",
            input: { contactId: "contact_retry_target", status: "Qualifie" },
          },
          { type: "create_task", input: { title: "Relance retry" } },
        ],
      }),
    });
    await seedLead(db, {
      tenantId: "tenant_resume_retry",
      contactId: "contact_resume_retry",
      leadId: "lead_resume_retry",
      ownerId: "user_resume_retry",
    });

    await expect(
      executeLeadFollowUpWorkflow(db, {
        tenantId: "tenant_resume_retry",
        leadId: "lead_resume_retry",
        contactId: "contact_resume_retry",
        ownerId: "user_resume_retry",
        source: "website",
        correlationId: "corr_resume_retry",
      }),
    ).rejects.toThrow("Contact introuvable");

    const runId = await loadRunId(db, "tenant_resume_retry");
    await seedContact(db, {
      tenantId: "tenant_resume_retry",
      contactId: "contact_retry_target",
      ownerId: "user_resume_retry",
    });
    await requestManualWorkflowRetry(db, "user_resume_retry", "tenant_resume_retry", {
      runId,
    });
    const summary = await processPendingDomainEvents(db, {
      now: new Date("2999-01-01T00:00:00.000Z"),
    });

    expect(summary.succeeded).toBe(1);
    expect(await loadRunStatus(db, "tenant_resume_retry")).toBe("succeeded");
    const retriedContactStatus = await loadContactStatus(
      db,
      "tenant_resume_retry",
      "contact_retry_target",
    );

    expect(retriedContactStatus).toBe("Qualifie");
    expect(
      await countRows(db, "tasks", "tenant_id = $1 and title = $2", [
        "tenant_resume_retry",
        "Relance retry",
      ]),
    ).toBe(1);
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
  await seedContact(db, input);
  const now = "2026-07-11T14:00:00.000Z";
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

async function seedContact(
  db: DbClient,
  input: {
    tenantId: string;
    contactId: string;
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
}

async function loadRunId(db: DbClient, tenantId: string) {
  const result = await db.query<{ id: string }>(
    "select id from workflow_runs where tenant_id = $1 limit 1",
    [tenantId],
  );

  return result.rows[0]?.id ?? "";
}

async function loadRunStatus(db: DbClient, tenantId: string) {
  const result = await db.query<{ status: string }>(
    "select status from workflow_runs where tenant_id = $1 limit 1",
    [tenantId],
  );

  return result.rows[0]?.status;
}

async function loadApprovalStatus(db: DbClient, tenantId: string) {
  const result = await db.query<{ status: string }>(
    "select status from approvals where tenant_id = $1 limit 1",
    [tenantId],
  );

  return result.rows[0]?.status;
}

async function loadContactStatus(
  db: DbClient,
  tenantId: string,
  contactId: string,
) {
  const result = await db.query<{ status: string }>(
    "select status from contacts where tenant_id = $1 and id = $2",
    [tenantId, contactId],
  );

  return result.rows[0]?.status;
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
