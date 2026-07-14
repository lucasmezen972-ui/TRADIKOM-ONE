import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { safeJson } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import { generateFinancialAssessment } from "../src/modules/financial-ai";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("Financial AI module", () => {
  it("calculates explainable estimates from declared inputs and tenant evidence", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Financial Owner",
      email: "financial-owner@example.com",
      password: "Password!1",
    });
    const outsider = await services.registerUser({
      name: "Financial Outsider",
      email: "financial-outsider@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Financial Garage",
      category: "Garage automobile",
    });
    await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
    await services.publishWebsite(owner.id, tenant.id);
    await services.createBusinessBrainEntry(owner.id, tenant.id, {
      domain: "margins",
      title: "Objectif de marge validé",
      summary: "La direction suit la marge mensuelle déclarée.",
      details: "",
      confidence: 90,
      sourceType: "manual",
      evidenceType: "document",
      evidenceSummary: "Compte-rendu mensuel de direction validé.",
    });
    await services.submitPublicLead(tenant.slug, {
      name: "Client Finance",
      email: "financial-client@example.com",
      phone: "+596 696 22 33 44",
      message: "Je souhaite un devis.",
    });
    const board = await services.getOpportunities(owner.id, tenant.id);
    const opportunity = board.opportunities[0];
    const stage = board.stages.find((item) => item.name === "A qualifier");
    if (!opportunity || !stage) throw new Error("Financial fixture is incomplete.");
    await services.updateOpportunity(owner.id, tenant.id, opportunity.id, {
      stageId: stage.id,
      valueCents: 2_000_000,
      nextFollowUpAt: new Date(Date.now() + 86_400_000).toISOString(),
      lostReason: undefined,
    });
    await services.generateSalesAiAssessments(owner.id, tenant.id);
    const operationalBefore = await countOperationalEffects(db, tenant.id);

    const snapshot = await services.recordFinancialInputSnapshot(
      owner.id,
      tenant.id,
      {
        period: "2026-07",
        monthlyRevenueCents: 10_000_000,
        operatingCostsCents: 8_000_000,
        cashBalanceCents: 2_000_000,
        cashInflowsCents: 9_000_000,
        cashOutflowsCents: 10_000_000,
        receivablesCents: 1_000_000,
        payablesCents: 1_500_000,
        marketingSpendCents: 500_000,
        salesSpendCents: 300_000,
        websiteSpendCents: 200_000,
        automationSpendCents: 100_000,
        newCustomers: 10,
        activeCustomers: 100,
        averageLifetimeMonths: 24,
        marketingAttributedRevenueCents: 1_500_000,
        salesAttributedRevenueCents: 900_000,
        websiteAttributedRevenueCents: null,
        automationSavingsCents: 300_000,
        evidenceSummary: "Relevé mensuel interne vérifié par la direction.",
      },
    );
    expect(snapshot).toMatchObject({ version: 1 });
    const generated = await services.generateFinancialAssessment(
      owner.id,
      tenant.id,
    );
    expect(generated.created).toBe(true);
    const workspace = await services.getFinancialAiWorkspace(owner.id, tenant.id);
    const assessment = workspace.assessments[0];
    expect(workspace.snapshots).toHaveLength(1);
    expect(assessment).toMatchObject({
      period: "2026-07",
      version: 1,
      monthlyRevenueCents: 10_000_000,
      estimatedProfitCents: 2_000_000,
      marginBasisPoints: 2_000,
      cashFlowCents: -1_000_000,
      cashRunwayMonths: 2,
      customerLifetimeValueCents: 2_400_000,
      customerAcquisitionCostCents: 80_000,
      marketingRoiBasisPoints: 20_000,
      salesRoiBasisPoints: 20_000,
      websiteRoiBasisPoints: null,
      automationRoiBasisPoints: 20_000,
      pipelineValueCents: 2_000_000,
    });
    expect(assessment!.weightedPipelineValueCents).toBeGreaterThan(0);
    expect(assessment!.forecastThreeMonthsCents).toBe(
      30_000_000 + assessment!.weightedPipelineValueCents,
    );
    expect(assessment!.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "declared_input" }),
        expect.objectContaining({ type: "crm_pipeline" }),
        expect.objectContaining({ type: "business_brain" }),
        expect.objectContaining({ type: "formula" }),
      ]),
    );
    expect(assessment!.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "negative_cash_flow", severity: "critical" }),
        expect.objectContaining({ code: "missing_attribution" }),
      ]),
    );
    expect(await countOperationalEffects(db, tenant.id)).toEqual(operationalBefore);

    const repeated = await services.generateFinancialAssessment(owner.id, tenant.id);
    expect(repeated).toMatchObject({ created: false, assessmentId: generated.assessmentId });

    await services.recordFinancialInputSnapshot(owner.id, tenant.id, {
      period: "2026-07",
      monthlyRevenueCents: 11_000_000,
      operatingCostsCents: 8_000_000,
      cashBalanceCents: 3_000_000,
      cashInflowsCents: 11_000_000,
      cashOutflowsCents: 9_000_000,
      receivablesCents: 1_000_000,
      payablesCents: 900_000,
      marketingSpendCents: 0,
      salesSpendCents: 0,
      websiteSpendCents: 0,
      automationSpendCents: 0,
      newCustomers: 0,
      activeCustomers: 0,
      averageLifetimeMonths: null,
      marketingAttributedRevenueCents: null,
      salesAttributedRevenueCents: null,
      websiteAttributedRevenueCents: null,
      automationSavingsCents: null,
      evidenceSummary: "Version corrigée après contrôle de la direction.",
    });
    expect((await services.getFinancialAiWorkspace(owner.id, tenant.id)).assessments).toEqual([]);
    await services.generateFinancialAssessment(owner.id, tenant.id);
    const revised = await services.getFinancialAiWorkspace(owner.id, tenant.id);
    expect(revised.snapshots[0]).toMatchObject({ version: 2 });
    expect(revised.assessments[0]).toMatchObject({
      version: 2,
      customerLifetimeValueCents: null,
      customerAcquisitionCostCents: null,
      marketingRoiBasisPoints: null,
    });
    const history = await db.query<{ status: string; version: number }>(
      `select status, version from financial_assessments
       where tenant_id = $1 order by version`,
      [tenant.id],
    );
    expect(history.rows).toEqual([
      { status: "superseded", version: 1 },
      { status: "current", version: 2 },
    ]);
    const audit = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action = 'financial_ai.assessment_generated'
       order by created_at desc limit 1`,
      [tenant.id],
    );
    expect(safeJson(audit.rows[0]?.safe_metadata, {})).toMatchObject({
      accountingWriteTriggered: false,
      externalActionTriggered: false,
      amountValuesRedacted: true,
    });
    expect(audit.rows[0]?.safe_metadata).not.toContain("11000000");

    await expect(
      services.getFinancialAiWorkspace(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.recordFinancialInputSnapshot(outsider.id, tenant.id, {
        period: "2026-07",
        monthlyRevenueCents: 0,
        operatingCostsCents: 0,
        cashBalanceCents: 0,
        cashInflowsCents: 0,
        cashOutflowsCents: 0,
        receivablesCents: 0,
        payablesCents: 0,
        marketingSpendCents: 0,
        salesSpendCents: 0,
        websiteSpendCents: 0,
        automationSpendCents: 0,
        newCustomers: 0,
        activeCustomers: 0,
        evidenceSummary: "Tentative interdite par un utilisateur externe.",
      }),
    ).rejects.toThrow("Acces refuse");
  });

  it("rolls back an assessment when evidence persistence fails", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Financial Rollback Owner",
      email: "financial-rollback@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Financial Rollback Garage",
      category: "Garage automobile",
    });
    await services.recordFinancialInputSnapshot(owner.id, tenant.id, {
      period: "2026-07",
      monthlyRevenueCents: 1_000_000,
      operatingCostsCents: 800_000,
      cashBalanceCents: 500_000,
      cashInflowsCents: 1_000_000,
      cashOutflowsCents: 900_000,
      receivablesCents: 0,
      payablesCents: 0,
      marketingSpendCents: 0,
      salesSpendCents: 0,
      websiteSpendCents: 0,
      automationSpendCents: 0,
      newCustomers: 0,
      activeCustomers: 0,
      evidenceSummary: "Photographie dédiée au test transactionnel.",
    });
    const failingDb: DbClient = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        if (sql.includes("insert into financial_assessment_evidence")) {
          throw new Error("injected financial evidence failure");
        }
        return db.query<T>(sql, params);
      },
    };

    await expect(
      generateFinancialAssessment(failingDb, owner.id, tenant.id),
    ).rejects.toThrow("injected financial evidence failure");
    expect(await countRows(db, "financial_assessments", tenant.id)).toBe(0);
    expect(await countRows(db, "financial_assessment_evidence", tenant.id)).toBe(0);
    expect(await countRows(db, "financial_alerts", tenant.id)).toBe(0);
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
    website_versions: number | string;
  }>(
    `select
       (select count(*) from activities where tenant_id = $1) as activities,
       (select count(*) from domain_events where tenant_id = $1) as domain_events,
       (select count(*) from notifications where tenant_id = $1) as notifications,
       (select count(*) from website_versions where tenant_id = $1) as website_versions`,
    [tenantId],
  );
  return {
    activities: Number(result.rows[0]?.activities ?? 0),
    domainEvents: Number(result.rows[0]?.domain_events ?? 0),
    notifications: Number(result.rows[0]?.notifications ?? 0),
    websiteVersions: Number(result.rows[0]?.website_versions ?? 0),
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
