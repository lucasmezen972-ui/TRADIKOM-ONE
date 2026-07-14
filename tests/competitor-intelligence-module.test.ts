import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { safeJson } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import { generateCompetitorInsights } from "../src/modules/competitor-intelligence";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("Competitor Intelligence module", () => {
  it("compares confirmed public observations without fetching or acting externally", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Competitor Owner",
      email: "competitor-owner@example.com",
      password: "Password!1",
    });
    const outsider = await services.registerUser({
      name: "Competitor Outsider",
      email: "competitor-outsider@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Competitor Garage",
      category: "Garage automobile",
    });
    const profile = await services.createCompetitorProfile(owner.id, tenant.id, {
      name: "Garage Public",
      websiteUrl: "https://competitor.example.org/?campaign=public#offer",
    });
    await expect(
      services.createCompetitorProfile(owner.id, tenant.id, {
        name: "garage public",
      }),
    ).rejects.toMatchObject({ code: "competitor_duplicate" });
    await expect(
      services.createCompetitorObservation(owner.id, tenant.id, {
        competitorId: profile.competitorId,
        category: "price",
        direction: "changed",
        sourceType: "official_website",
        sourceUrl: "https://competitor.example.org/?token=secret",
        title: "URL non sûre",
        summary: "Ce contenu ne doit jamais être enregistré.",
        observedAt: "2026-07-13T09:00:00.000Z",
        publicSourceConfirmed: true,
        protectedContentExcluded: true,
      }),
    ).rejects.toThrow("paramètre sensible");

    const firstSummary = "Le forfait public est affiché à 120 euros sur la page tarifaire.";
    const firstInput = {
      competitorId: profile.competitorId,
      category: "price" as const,
      direction: "increase" as const,
      sourceType: "official_website" as const,
      sourceUrl: "https://competitor.example.org/pricing?campaign=summer#public",
      title: "Forfait public à 120 euros",
      summary: firstSummary,
      observedValue: "120 EUR",
      observedAt: "2026-07-13T09:00:00.000Z",
      publicSourceConfirmed: true,
      protectedContentExcluded: true,
    };
    await services.createCompetitorObservation(owner.id, tenant.id, firstInput);
    await expect(
      services.createCompetitorObservation(owner.id, tenant.id, firstInput),
    ).rejects.toMatchObject({ code: "competitor_observation_duplicate" });

    const operationalBefore = await countOperationalEffects(db, tenant.id);
    const baseline = await services.generateCompetitorInsights(owner.id, tenant.id);
    expect(baseline).toMatchObject({ observationGroupCount: 1, supersededCount: 0 });
    expect(baseline.createdIds).toHaveLength(1);
    await services.submitCompetitorInsightForApproval(owner.id, tenant.id, {
      insightId: baseline.createdIds[0]!,
    });

    const secondSummary = "Le même forfait public est désormais affiché à 95 euros.";
    await services.createCompetitorObservation(owner.id, tenant.id, {
      ...firstInput,
      direction: "decrease",
      title: "Forfait public à 95 euros",
      summary: secondSummary,
      observedValue: "95 EUR",
      observedAt: "2026-07-14T09:00:00.000Z",
    });
    const refreshed = await services.generateCompetitorInsights(owner.id, tenant.id);
    expect(refreshed.createdIds).toHaveLength(1);
    expect(refreshed.supersededCount).toBe(1);
    let workspace = await services.getCompetitorIntelligenceWorkspace(
      owner.id,
      tenant.id,
    );
    expect(workspace.competitors[0]).toMatchObject({
      id: profile.competitorId,
      websiteUrl: "https://competitor.example.org/",
    });
    expect(workspace.observations[0]?.sourceUrl).toBe(
      "https://competitor.example.org/pricing",
    );
    expect(workspace.insights).toHaveLength(1);
    expect(workspace.insights[0]).toMatchObject({
      impact: "risk",
      confidence: 90,
      version: 2,
      status: "proposed",
    });
    expect(workspace.insights[0]?.evidence).toHaveLength(2);
    expect(workspace.insights[0]?.recommendedAction).toContain(
      "sans modifier automatiquement les prix",
    );

    const currentInsight = workspace.insights[0]!;
    await services.submitCompetitorInsightForApproval(owner.id, tenant.id, {
      insightId: currentInsight.id,
    });
    const dashboard = await services.getDashboard(owner.id, tenant.id);
    expect(dashboard.commandCenter.pendingApprovals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Décision de veille concurrentielle",
          actionHref: "/veille-concurrentielle",
          approvalType: "competitor",
        }),
      ]),
    );
    await services.decideCompetitorInsight(owner.id, tenant.id, {
      insightId: currentInsight.id,
      decision: "approved",
      reason: "Analyse utile pour une comparaison interne uniquement.",
    });

    await services.createCompetitorObservation(owner.id, tenant.id, {
      competitorId: profile.competitorId,
      category: "review",
      direction: "negative_signal",
      sourceType: "public_review",
      sourceUrl: "https://reviews.example.org/garage-public",
      title: "Avis public sur les délais",
      summary: "Plusieurs commentaires publics mentionnent un délai de prise en charge.",
      observedAt: "2026-07-14T10:00:00.000Z",
      publicSourceConfirmed: true,
      protectedContentExcluded: true,
    });
    const reviewInsight = await services.generateCompetitorInsights(owner.id, tenant.id);
    expect(reviewInsight.createdIds).toHaveLength(1);
    await services.submitCompetitorInsightForApproval(owner.id, tenant.id, {
      insightId: reviewInsight.createdIds[0]!,
    });
    await services.decideCompetitorInsight(owner.id, tenant.id, {
      insightId: reviewInsight.createdIds[0]!,
      decision: "rejected",
      reason: "Une seconde preuve publique est nécessaire.",
    });
    workspace = await services.getCompetitorIntelligenceWorkspace(owner.id, tenant.id);
    expect(workspace.insights.map((insight) => insight.status).sort()).toEqual([
      "approved",
      "rejected",
    ]);
    expect(await countOperationalEffects(db, tenant.id)).toEqual(operationalBefore);

    const supersededApproval = await db.query<{ status: string }>(
      `select status from approvals
       where tenant_id = $1 and target_type = 'competitor_insight'
         and target_id = $2`,
      [tenant.id, baseline.createdIds[0]],
    );
    expect(supersededApproval.rows[0]?.status).toBe("superseded");
    const audit = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action like 'competitor.%'`,
      [tenant.id],
    );
    expect(audit.rows).not.toHaveLength(0);
    for (const row of audit.rows) {
      const serialized = JSON.stringify(safeJson(row.safe_metadata, {}));
      expect(serialized).not.toContain(firstSummary);
      expect(serialized).not.toContain(secondSummary);
      expect(serialized).not.toContain("competitor.example.org");
    }

    await expect(
      services.getCompetitorIntelligenceWorkspace(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.createCompetitorProfile(outsider.id, tenant.id, {
        name: "Interdit",
      }),
    ).rejects.toThrow("Acces refuse");
  });

  it("rolls back an insight when evidence persistence fails", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Competitor Rollback Owner",
      email: "competitor-rollback@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Competitor Rollback Garage",
      category: "Garage automobile",
    });
    const profile = await services.createCompetitorProfile(owner.id, tenant.id, {
      name: "Concurrent Rollback",
    });
    await services.createCompetitorObservation(owner.id, tenant.id, {
      competitorId: profile.competitorId,
      category: "service",
      direction: "new",
      sourceType: "public_announcement",
      sourceUrl: "https://public.example.org/new-service",
      title: "Nouveau service public",
      summary: "Une annonce publique décrit un nouveau service concurrent.",
      observedAt: "2026-07-14T12:00:00.000Z",
      publicSourceConfirmed: true,
      protectedContentExcluded: true,
    });
    const failingDb: DbClient = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        if (sql.includes("insert into competitor_insight_evidence")) {
          throw new Error("injected competitor evidence failure");
        }
        return db.query<T>(sql, params);
      },
    };

    await expect(
      generateCompetitorInsights(failingDb, owner.id, tenant.id),
    ).rejects.toThrow("injected competitor evidence failure");
    expect(await countRows(db, "competitor_insights", tenant.id)).toBe(0);
    expect(await countRows(db, "competitor_insight_evidence", tenant.id)).toBe(0);
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
