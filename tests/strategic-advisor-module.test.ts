import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { safeJson } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import { getDashboardData } from "../src/modules/dashboard";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("strategic advisor module", () => {
  it("creates evidence-backed proposals without executing external or domain actions", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Strategic Owner",
      email: "strategic-owner@example.com",
      password: "Password!1",
    });
    const outsider = await services.registerUser({
      name: "Strategic Outsider",
      email: "strategic-outsider@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Strategic Garage",
      category: "Garage automobile",
    });
    await services.saveOnboarding(
      owner.id,
      tenant.id,
      defaultGarageOnboarding(),
    );
    const objectiveId = await services.createBusinessBrainEntry(
      owner.id,
      tenant.id,
      {
        domain: "objectives",
        title: "Développer les contrats récurrents",
        summary: "Signer dix contrats récurrents avant la fin du trimestre.",
        details: "Cible validée par la direction.",
        confidence: 88,
        sourceType: "manual",
        evidenceType: "document",
        evidenceSummary: "Compte-rendu de la revue trimestrielle.",
      },
    );
    const before = await countOperationalEffects(db, tenant.id);

    const generation = await services.generateStrategicRecommendations(
      owner.id,
      tenant.id,
    );
    expect(generation.createdIds.length).toBeGreaterThanOrEqual(2);
    const recommendations = await services.getStrategicAdvisor(
      owner.id,
      tenant.id,
    );
    expect(recommendations).toHaveLength(generation.createdIds.length);
    expect(
      recommendations.every(
        (item) =>
          item.status === "proposed" &&
          item.evidence.length > 0 &&
          item.rationale.length >= 10 &&
          item.expectedGain.length >= 5 &&
          item.roiSummary.length >= 5 &&
          item.riskSummary.length >= 5 &&
          item.actionHref.startsWith("/") &&
          item.confidence >= 0 &&
          item.confidence <= 100,
      ),
    ).toBe(true);
    const objectiveRecommendation = recommendations.find((item) =>
      item.ruleKey.startsWith("executive.objective."),
    );
    expect(objectiveRecommendation).toMatchObject({
      role: "executive",
      confidence: 88,
      evidence: [
        {
          type: "business_brain_entry",
          ref: objectiveId,
        },
      ],
    });

    const repeated = await services.generateStrategicRecommendations(
      owner.id,
      tenant.id,
    );
    expect(repeated).toMatchObject({
      createdIds: [],
      candidateCount: generation.candidateCount,
    });

    const recommendation = recommendations[0];
    if (!recommendation) {
      throw new Error("Strategic recommendation fixture is missing.");
    }
    await services.decideStrategicRecommendation(owner.id, tenant.id, {
      recommendationId: recommendation.id,
      decision: "approved",
      reason: "Orientation validée pour préparation, sans exécution automatique.",
    });
    const decided = await services.getStrategicAdvisor(owner.id, tenant.id);
    expect(decided.find((item) => item.id === recommendation.id)).toMatchObject({
      status: "approved",
      decisionReason:
        "Orientation validée pour préparation, sans exécution automatique.",
    });
    const decision = await db.query<{
      decision: string;
      reason: string;
    }>(
      `select decision, reason
       from strategic_recommendation_decisions
       where tenant_id = $1 and recommendation_id = $2`,
      [tenant.id, recommendation.id],
    );
    expect(decision.rows).toEqual([
      {
        decision: "approved",
        reason:
          "Orientation validée pour préparation, sans exécution automatique.",
      },
    ]);
    const approval = await db.query<{ status: string }>(
      `select status from approvals
       where tenant_id = $1 and target_type = 'strategic_recommendation'
         and target_id = $2`,
      [tenant.id, recommendation.id],
    );
    expect(approval.rows).toEqual([{ status: "approved" }]);
    const audit = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1
         and action = 'strategic_advisor.recommendation_approved'
       order by created_at desc limit 1`,
      [tenant.id],
    );
    expect(safeJson(audit.rows[0]?.safe_metadata, {})).toMatchObject({
      executionTriggered: false,
    });
    expect(await countOperationalEffects(db, tenant.id)).toEqual(before);

    const dashboard = await getDashboardData(db, owner.id, tenant.id, {
      now: new Date("2026-07-14T16:00:00.000Z"),
      timeZone: "America/Martinique",
    });
    expect(
      dashboard.commandCenter.pendingApprovals.some(
        (item) =>
          item.approvalType === "strategic" &&
          item.actionHref === "/conseiller-strategique",
      ),
    ).toBe(true);

    await expect(
      services.getStrategicAdvisor(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.generateStrategicRecommendations(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
  });

  it("supersedes stale proposals when their evidence changes", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Strategic Refresh Owner",
      email: "strategic-refresh@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Strategic Refresh Garage",
      category: "Services",
    });

    const first = await services.generateStrategicRecommendations(
      owner.id,
      tenant.id,
    );
    expect(first.createdIds).toHaveLength(1);
    await services.createBusinessBrainEntry(owner.id, tenant.id, {
      domain: "suppliers",
      title: "Fournisseur principal",
      summary: "Le fournisseur principal a été validé.",
      details: "",
      confidence: 95,
      sourceType: "manual",
      evidenceType: "document",
      evidenceSummary: "Contrat fournisseur vérifié.",
    });

    const refreshed = await services.generateStrategicRecommendations(
      owner.id,
      tenant.id,
    );
    expect(refreshed.createdIds).toHaveLength(1);
    const history = await db.query<{
      id: string;
      status: string;
    }>(
      `select id, status from strategic_recommendations
       where tenant_id = $1 and rule_key = 'executive.knowledge_coverage'
       order by created_at asc`,
      [tenant.id],
    );
    expect(history.rows).toEqual([
      { id: first.createdIds[0], status: "superseded" },
      { id: refreshed.createdIds[0], status: "proposed" },
    ]);
    const approvals = await db.query<{ status: string }>(
      `select status from approvals
       where tenant_id = $1 and target_type = 'strategic_recommendation'
       order by created_at asc`,
      [tenant.id],
    );
    expect(approvals.rows).toEqual([
      { status: "superseded" },
      { status: "pending" },
    ]);
  });
});

async function countOperationalEffects(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  tenantId: string,
) {
  const result = await db.query<{
    workflows: number | string;
    connectors: number | string;
    activities: number | string;
    domain_events: number | string;
  }>(
    `select
       (select count(*)::int from workflows where tenant_id = $1) as workflows,
       (select count(*)::int from connectors where tenant_id = $1) as connectors,
       (select count(*)::int from activities where tenant_id = $1) as activities,
       (select count(*)::int from domain_events where tenant_id = $1) as domain_events`,
    [tenantId],
  );
  return {
    workflows: Number(result.rows[0]?.workflows),
    connectors: Number(result.rows[0]?.connectors),
    activities: Number(result.rows[0]?.activities),
    domainEvents: Number(result.rows[0]?.domain_events),
  };
}
