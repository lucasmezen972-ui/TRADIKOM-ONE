import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { safeJson } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import { generateSalesAiAssessments } from "../src/modules/sales-ai";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("Sales AI module", () => {
  it("versions evidence-backed assessments without operational side effects", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Sales AI Owner",
      email: "sales-ai-owner@example.com",
      password: "Password!1",
    });
    const outsider = await services.registerUser({
      name: "Sales AI Outsider",
      email: "sales-ai-outsider@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Sales AI Garage",
      category: "Garage automobile",
    });
    await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
    await services.publishWebsite(owner.id, tenant.id);
    await services.submitPublicLead(tenant.slug, {
      name: "Client Sales AI",
      email: "client-sales-ai@example.com",
      phone: "+596 696 88 99 00",
      message: "Je souhaite un diagnostic.",
    });
    const board = await services.getOpportunities(owner.id, tenant.id);
    const opportunity = board.opportunities[0];
    const activeStage = board.stages.find((stage) => stage.name === "A qualifier");
    const lostStage = board.stages.find((stage) => stage.name === "Perdu");
    if (!opportunity || !activeStage || !lostStage) {
      throw new Error("Sales AI fixture is incomplete.");
    }
    await services.updateOpportunity(owner.id, tenant.id, opportunity.id, {
      stageId: activeStage.id,
      valueCents: 180000,
      nextFollowUpAt: new Date(Date.now() - 86_400_000).toISOString(),
      lostReason: undefined,
    });
    const before = await countOperationalEffects(db, tenant.id);

    const generated = await services.generateSalesAiAssessments(
      owner.id,
      tenant.id,
    );
    expect(generated).toMatchObject({ candidateCount: 1, supersededCount: 0 });
    expect(generated.createdIds).toHaveLength(1);
    const workspace = await services.getSalesAiWorkspace(owner.id, tenant.id);
    expect(workspace).toHaveLength(1);
    expect(workspace[0]).toMatchObject({
      opportunityId: opportunity.id,
      priority: "high",
      version: 1,
      valueCents: 180000,
    });
    expect(workspace[0]!.evidence).toHaveLength(6);
    expect(workspace[0]!.score).toBeGreaterThanOrEqual(0);
    expect(workspace[0]!.closingEstimate).toBeGreaterThanOrEqual(5);
    expect(workspace[0]!.riskSummary).toContain("retard");
    expect(workspace[0]!.actionHref).toBe(`/opportunites/${opportunity.id}`);
    expect(await countOperationalEffects(db, tenant.id)).toEqual(before);

    const repeated = await services.generateSalesAiAssessments(owner.id, tenant.id);
    expect(repeated).toMatchObject({
      createdIds: [],
      candidateCount: 1,
      supersededCount: 0,
    });

    await services.updateOpportunity(owner.id, tenant.id, opportunity.id, {
      stageId: activeStage.id,
      valueCents: 200000,
      nextFollowUpAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      lostReason: undefined,
    });
    const refreshed = await services.generateSalesAiAssessments(owner.id, tenant.id);
    expect(refreshed.createdIds).toHaveLength(1);
    expect(refreshed.supersededCount).toBe(1);
    const refreshedWorkspace = await services.getSalesAiWorkspace(owner.id, tenant.id);
    expect(refreshedWorkspace[0]).toMatchObject({ version: 2, valueCents: 200000 });

    await services.updateOpportunity(owner.id, tenant.id, opportunity.id, {
      stageId: lostStage.id,
      valueCents: 200000,
      nextFollowUpAt: undefined,
      lostReason: "Projet abandonne par le client.",
    });
    const closed = await services.generateSalesAiAssessments(owner.id, tenant.id);
    expect(closed).toMatchObject({
      createdIds: [],
      candidateCount: 0,
      supersededCount: 1,
    });
    expect(await services.getSalesAiWorkspace(owner.id, tenant.id)).toEqual([]);
    const history = await db.query<{ status: string; version: number }>(
      `select status, version from sales_ai_assessments
       where tenant_id = $1 order by version`,
      [tenant.id],
    );
    expect(history.rows).toEqual([
      { status: "superseded", version: 1 },
      { status: "superseded", version: 2 },
    ]);
    const audit = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action = 'sales_ai.assessments_generated'
       order by created_at desc limit 1`,
      [tenant.id],
    );
    expect(safeJson(audit.rows[0]?.safe_metadata, {})).toMatchObject({
      externalActionTriggered: false,
      messageGenerated: false,
      quotationGenerated: false,
      discountSuggested: false,
    });
    await expect(
      services.getSalesAiWorkspace(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.generateSalesAiAssessments(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
  });

  it("rolls back an assessment when evidence persistence fails", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Sales AI Rollback Owner",
      email: "sales-ai-rollback@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Sales AI Rollback Garage",
      category: "Garage automobile",
    });
    await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
    await services.publishWebsite(owner.id, tenant.id);
    await services.submitPublicLead(tenant.slug, {
      name: "Client Rollback",
      email: "sales-ai-rollback-client@example.com",
      phone: "+596 696 10 20 30",
      message: "Demande de test transactionnel.",
    });
    const failingDb: DbClient = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        if (sql.includes("insert into sales_ai_evidence")) {
          throw new Error("injected Sales AI evidence failure");
        }
        return db.query<T>(sql, params);
      },
    };

    await expect(
      generateSalesAiAssessments(failingDb, owner.id, tenant.id),
    ).rejects.toThrow("injected Sales AI evidence failure");
    expect(await countRows(db, "sales_ai_assessments", tenant.id)).toBe(0);
    expect(await countRows(db, "sales_ai_evidence", tenant.id)).toBe(0);
  });
});

async function countOperationalEffects(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  tenantId: string,
) {
  const result = await db.query<{
    activities: number | string;
    domain_events: number | string;
    notifications: number | string;
  }>(
    `select
       (select count(*) from activities where tenant_id = $1) as activities,
       (select count(*) from domain_events where tenant_id = $1) as domain_events,
       (select count(*) from notifications where tenant_id = $1) as notifications`,
    [tenantId],
  );
  return {
    activities: Number(result.rows[0]?.activities ?? 0),
    domainEvents: Number(result.rows[0]?.domain_events ?? 0),
    notifications: Number(result.rows[0]?.notifications ?? 0),
  };
}

async function countRows(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  table: string,
  tenantId: string,
) {
  const result = await db.query<{ count: number | string }>(
    `select count(*) as count from ${table} where tenant_id = $1`,
    [tenantId],
  );
  return Number(result.rows[0]?.count ?? 0);
}
