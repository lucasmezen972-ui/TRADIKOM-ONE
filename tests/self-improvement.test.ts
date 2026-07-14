import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import { id, safeJson } from "../src/lib/security";
import { generateSelfImprovementProposals } from "../src/modules/self-improvement";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("Self Improvement", () => {
  it("creates explainable versioned proposals without operational side effects", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Improvement Owner",
      email: "improvement-owner@example.com",
      password: "Password!1",
    });
    const outsider = await services.registerUser({
      name: "Improvement Outsider",
      email: "improvement-outsider@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Improvement Garage",
      category: "Garage automobile",
    });
    await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
    const old = new Date(Date.now() - 45 * 24 * 60 * 60 * 1_000).toISOString();
    await db.query(
      "update workflows set created_at = $1 where tenant_id = $2 and status = 'active'",
      [old, tenant.id],
    );
    const sourceWorkflow = await db.query<{ definition: string }>(
      "select definition from workflows where tenant_id = $1 limit 1",
      [tenant.id],
    );
    const failedWorkflowId = id("workflow");
    await db.query(
      `insert into workflows (
         id, tenant_id, workflow_key, name, trigger_name, status,
         approval_policy, definition, created_at
       ) values ($1, $2, $3, $4, 'manual.test', 'active',
         'user_approval_required', $5, $6)`,
      [
        failedWorkflowId,
        tenant.id,
        "self-improvement-failed",
        "Workflow à fiabiliser",
        sourceWorkflow.rows[0]?.definition,
        old,
      ],
    );
    await db.query(
      `insert into workflow_runs (
         id, tenant_id, workflow_key, trigger_name, status, summary, error,
         retry_count, created_at
       ) values ($1, $2, $3, 'manual.test', 'failed',
         'Échec terminal de test', 'safe_failure', 3, $4)`,
      [id("run"), tenant.id, "self-improvement-failed", old],
    );
    await db.query(
      `update connectors set status = 'Connecté', health = 'warning',
         last_sync_at = null, created_at = $1, updated_at = $1
       where tenant_id = $2 and connector_key = 'mock_business'`,
      [old, tenant.id],
    );
    await insertContact(db, tenant.id, "Alpha Contact", "alpha@example.com", "+596 696 00 11 22");
    await insertContact(db, tenant.id, "Bravo Contact", "bravo@example.com", "+596696001122");
    await db.query(
      "update website_pages set seo_metadata = '{}' where tenant_id = $1",
      [tenant.id],
    );
    await db.query(
      `update website_sections set button_label = null, button_href = null
       where tenant_id = $1 and type = 'hero'`,
      [tenant.id],
    );
    const before = await countOperationalEffects(db, tenant.id);

    expect(
      await services.generateSelfImprovementProposals(owner.id, tenant.id),
    ).toEqual({ detectedCount: 7, createdCount: 7, unchangedCount: 0, resolvedCount: 0 });
    expect(
      await services.generateSelfImprovementProposals(owner.id, tenant.id),
    ).toEqual({ detectedCount: 7, createdCount: 0, unchangedCount: 7, resolvedCount: 0 });

    let workspace = await services.getSelfImprovementWorkspace(owner.id, tenant.id);
    expect(workspace.proposals).toHaveLength(7);
    expect(new Set(workspace.proposals.map((item) => item.category))).toEqual(
      new Set([
        "workflow_failed",
        "workflow_unused",
        "connector_degraded",
        "connector_unused",
        "contact_duplicates",
        "seo_metadata",
        "website_cta",
      ]),
    );
    expect(workspace.proposals.every((item) => item.evidence.length === 1)).toBe(true);
    expect(JSON.stringify(workspace)).not.toMatch(
      /Alpha Contact|Bravo Contact|alpha@example|bravo@example|596696001122/i,
    );
    expect(workspace.coverage.filter((item) => item.status === "unavailable")).toHaveLength(4);

    const duplicateProposal = workspace.proposals.find(
      (item) => item.category === "contact_duplicates",
    );
    if (!duplicateProposal) throw new Error("Duplicate improvement fixture is missing.");
    expect(
      await services.decideSelfImprovementProposal(owner.id, tenant.id, {
        proposalId: duplicateProposal.id,
        decision: "accepted",
        reason: "Revue CRM planifiée sans fusion automatique.",
      }),
    ).toEqual({
      proposalId: duplicateProposal.id,
      decision: "accepted",
      planningOnly: true,
    });
    workspace = await services.getSelfImprovementWorkspace(owner.id, tenant.id);
    expect(
      workspace.proposals.find((item) => item.id === duplicateProposal.id)?.decisionStatus,
    ).toBe("accepted");

    await db.query(
      `update connectors set health = 'error'
       where tenant_id = $1 and connector_key = 'mock_business'`,
      [tenant.id],
    );
    expect(
      await services.generateSelfImprovementProposals(owner.id, tenant.id),
    ).toEqual({ detectedCount: 7, createdCount: 1, unchangedCount: 6, resolvedCount: 0 });
    const connectorHistory = await db.query<{
      version: number;
      record_status: string;
      decision_status: string;
    }>(
      `select version, record_status, decision_status
       from self_improvement_proposals
       where tenant_id = $1 and category = 'connector_degraded'
       order by version`,
      [tenant.id],
    );
    expect(connectorHistory.rows).toEqual([
      { version: 1, record_status: "superseded", decision_status: "pending" },
      { version: 2, record_status: "current", decision_status: "pending" },
    ]);
    expect(await countOperationalEffects(db, tenant.id)).toEqual(before);

    const audit = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action = 'self_improvement.proposals_generated'
       order by created_at desc limit 1`,
      [tenant.id],
    );
    expect(safeJson(audit.rows[0]?.safe_metadata, {})).toMatchObject({
      automaticChangeTriggered: false,
      externalActionTriggered: false,
      customerContentStored: false,
    });

    await expect(
      services.getSelfImprovementWorkspace(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.generateSelfImprovementProposals(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
  });

  it("resolves disappeared signals and rolls back when audit recording fails", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Improvement Rollback Owner",
      email: "improvement-rollback@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Improvement Rollback Garage",
      category: "Garage automobile",
    });
    const old = new Date(Date.now() - 45 * 24 * 60 * 60 * 1_000).toISOString();
    await db.query("update workflows set created_at = $1 where tenant_id = $2", [
      old,
      tenant.id,
    ]);
    const failingDb: DbClient = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        if (sql.includes("insert into audit_logs")) {
          throw new Error("injected self improvement audit failure");
        }
        return db.query<T>(sql, params);
      },
    };
    await expect(
      generateSelfImprovementProposals(failingDb, owner.id, tenant.id),
    ).rejects.toThrow("injected self improvement audit failure");
    expect(
      Number(
        (
          await db.query<{ count: number | string }>(
            "select count(*) as count from self_improvement_proposals where tenant_id = $1",
            [tenant.id],
          )
        ).rows[0]?.count ?? 0,
      ),
    ).toBe(0);

    await services.generateSelfImprovementProposals(owner.id, tenant.id);
    await db.query(
      "update workflows set status = 'paused' where tenant_id = $1",
      [tenant.id],
    );
    const regenerated = await services.generateSelfImprovementProposals(
      owner.id,
      tenant.id,
    );
    expect(regenerated).toMatchObject({ createdCount: 0, resolvedCount: 1 });
    const history = await db.query<{ record_status: string }>(
      `select record_status from self_improvement_proposals
       where tenant_id = $1 and category = 'workflow_unused'`,
      [tenant.id],
    );
    expect(history.rows).toEqual([{ record_status: "resolved" }]);
  });
});

async function insertContact(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  tenantId: string,
  name: string,
  email: string,
  phone: string,
) {
  const now = new Date().toISOString();
  await db.query(
    `insert into contacts (
       id, tenant_id, name, email, phone, status, source, tags,
       assigned_user_id, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, 'lead', 'manual', '[]', null, $6, $6)`,
    [id("contact"), tenantId, name, email, phone, now],
  );
}

async function countOperationalEffects(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  tenantId: string,
) {
  const result = await db.query<{
    tasks: number | string;
    events: number | string;
    notifications: number | string;
    activities: number | string;
    merges: number | string;
    publications: number | string;
  }>(
    `select
       (select count(*) from tasks where tenant_id = $1) as tasks,
       (select count(*) from domain_events where tenant_id = $1) as events,
       (select count(*) from notifications where tenant_id = $1) as notifications,
       (select count(*) from activities where tenant_id = $1) as activities,
       (select count(*) from contact_merge_records where tenant_id = $1) as merges,
       (select count(*) from website_publications where tenant_id = $1) as publications`,
    [tenantId],
  );
  return {
    tasks: Number(result.rows[0]?.tasks ?? 0),
    events: Number(result.rows[0]?.events ?? 0),
    notifications: Number(result.rows[0]?.notifications ?? 0),
    activities: Number(result.rows[0]?.activities ?? 0),
    merges: Number(result.rows[0]?.merges ?? 0),
    publications: Number(result.rows[0]?.publications ?? 0),
  };
}
