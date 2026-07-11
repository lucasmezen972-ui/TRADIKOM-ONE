import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import { toJson } from "../src/lib/security";
import {
  executeLeadFollowUpWorkflow,
  leadFollowUpWorkflow,
} from "../src/modules/workflows";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { db, services: createServices(db) };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("workflow engine", () => {
  it("executes the tenant persisted lead workflow and skips replayed events", async () => {
    const { db, services } = await setup();
    const ownerA = await services.registerUser({
      name: "Malia Workflow A",
      email: "malia.workflow.a@example.com",
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "Malia Workflow B",
      email: "malia.workflow.b@example.com",
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: "Garage Workflow A",
      category: "Garage automobile",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: "Garage Workflow B",
      category: "Garage automobile",
    });
    const customDefinition = {
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
    };

    await db.query(
      "update workflows set definition = $1 where tenant_id = $2 and workflow_key = $3",
      [toJson(customDefinition), tenantA.id, leadFollowUpWorkflow.key],
    );

    await services.saveOnboarding(
      ownerA.id,
      tenantA.id,
      defaultGarageOnboarding(),
    );
    await services.saveOnboarding(
      ownerB.id,
      tenantB.id,
      defaultGarageOnboarding(),
    );
    await services.publishWebsite(ownerA.id, tenantA.id);
    await services.publishWebsite(ownerB.id, tenantB.id);

    const leadA = await services.submitPublicLead(tenantA.slug, {
      name: "Client Workflow A",
      email: "client.workflow.a@example.com",
      phone: "+596 696 10 10 10",
      message: "Demande workflow A",
    });
    await services.submitPublicLead(tenantB.slug, {
      name: "Client Workflow B",
      email: "client.workflow.b@example.com",
      phone: "+596 696 20 20 20",
      message: "Demande workflow B",
    });

    const crmA = await services.getCrm(ownerA.id, tenantA.id);
    const crmB = await services.getCrm(ownerB.id, tenantB.id);
    const contactA = crmA.contacts.find(
      (contact) => contact.email === "client.workflow.a@example.com",
    );
    const contactB = crmB.contacts.find(
      (contact) => contact.email === "client.workflow.b@example.com",
    );

    expect(contactA).toBeDefined();
    expect(contactB).toBeDefined();
    if (!contactA || !contactB) {
      throw new Error("Contacts workflow introuvables.");
    }

    expect(contactA.tags).toEqual(
      expect.arrayContaining(["website", "workflow-persisted"]),
    );
    expect(contactB.tags).not.toContain("workflow-persisted");
    expect(crmA.tasks[0]?.title).toBe("Relance persistante sous 2h");
    expect(crmB.tasks[0]?.title).toBe("Relancer le nouveau lead site sous 24h");

    const replayedRun = await executeLeadFollowUpWorkflow(db, {
      tenantId: tenantA.id,
      leadId: leadA,
      contactId: contactA.id,
      ownerId: ownerA.id,
      source: "website",
      correlationId: "replayed-correlation",
    });
    expect(replayedRun).toBeNull();

    const taskCount = await db.query<{ count: number }>(
      "select count(*)::int as count from tasks where tenant_id = $1 and title = $2",
      [tenantA.id, "Relance persistante sous 2h"],
    );
    const runCount = await db.query<{ count: number }>(
      "select count(*)::int as count from workflow_runs where tenant_id = $1",
      [tenantA.id],
    );
    const steps = await db.query<{
      action_name: string;
      status: string;
      safe_metadata: string;
    }>(
      `select action_name, status, safe_metadata
       from workflow_run_steps
       where tenant_id = $1`,
      [tenantA.id],
    );
    const orderedSteps = steps.rows
      .map((step) => ({
        action_name: step.action_name,
        status: step.status,
        actionIndex: Number(JSON.parse(step.safe_metadata).actionIndex),
      }))
      .sort((left, right) => left.actionIndex - right.actionIndex)
      .map(({ action_name, status }) => ({ action_name, status }));

    expect(taskCount.rows[0]?.count).toBe(1);
    expect(runCount.rows[0]?.count).toBe(1);
    expect(orderedSteps).toEqual([
      { action_name: "create_task", status: "succeeded" },
      { action_name: "add_tag", status: "succeeded" },
      { action_name: "send_mock_email", status: "succeeded" },
      { action_name: "create_activity", status: "succeeded" },
    ]);
  });

  it("records approval-required workflow runs without executing later actions", async () => {
    const { db, services } = await setup();
    const owner = await services.registerUser({
      name: "Malia Approval",
      email: "malia.workflow.approval@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Garage Workflow Approval",
      category: "Garage automobile",
    });
    const approvalDefinition = {
      ...leadFollowUpWorkflow,
      version: 3,
      approvalPolicy: "user_approval_required",
      actions: [
        { type: "request_approval", input: {} },
        { type: "create_task", input: { title: "Ne doit pas etre creee" } },
      ],
    };

    await db.query(
      "update workflows set approval_policy = $1, definition = $2 where tenant_id = $3 and workflow_key = $4",
      [
        approvalDefinition.approvalPolicy,
        toJson(approvalDefinition),
        tenant.id,
        leadFollowUpWorkflow.key,
      ],
    );
    await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
    await services.publishWebsite(owner.id, tenant.id);

    await services.submitPublicLead(tenant.slug, {
      name: "Client Approval",
      email: "client.workflow.approval@example.com",
      phone: "+596 696 30 30 30",
      message: "Demande workflow approval",
    });

    const run = await db.query<{ status: string }>(
      "select status from workflow_runs where tenant_id = $1 limit 1",
      [tenant.id],
    );
    const approvals = await db.query<{ count: number }>(
      "select count(*)::int as count from approvals where tenant_id = $1 and status = $2",
      [tenant.id, "pending"],
    );
    const blockedTasks = await db.query<{ count: number }>(
      "select count(*)::int as count from tasks where tenant_id = $1 and title = $2",
      [tenant.id, "Ne doit pas etre creee"],
    );

    expect(run.rows[0]?.status).toBe("approval_required");
    expect(approvals.rows[0]?.count).toBe(1);
    expect(blockedTasks.rows[0]?.count).toBe(0);
  });
});
