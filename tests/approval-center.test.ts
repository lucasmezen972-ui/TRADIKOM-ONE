import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

async function setupTenantWithProposals(suffix: string) {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: `Owner Validations ${suffix}`,
    email: `owner.validations.${suffix}@example.com`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Garage Validations ${suffix}`,
    category: "Garage automobile",
  });
  await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
  await services.createBusinessBrainEntry(owner.id, tenant.id, {
    domain: "objectives",
    title: "Développer les contrats récurrents",
    summary: "Signer dix contrats récurrents avant la fin du trimestre.",
    details: "Cible validée par la direction.",
    confidence: 88,
    sourceType: "manual",
    evidenceType: "document",
    evidenceSummary: "Compte-rendu de la revue trimestrielle.",
  });
  await services.generateStrategicRecommendations(owner.id, tenant.id);
  return { db, services, owner, tenant };
}

describe("approval center", () => {
  it("aggregates pending proposals with the content needed to decide", async () => {
    const { services, owner, tenant } =
      await setupTenantWithProposals("contenu");

    const center = await services.getApprovalCenter(owner.id, tenant.id);
    expect(center.canApprove).toBe(true);
    expect(center.pending.length).toBeGreaterThan(0);

    const strategic = center.pending.find((item) => item.kind === "strategic");
    expect(strategic).toBeDefined();
    expect(strategic).toMatchObject({
      kindLabel: "Décision stratégique",
      detailHref: "/conseiller-strategique",
      decisionField: "recommendationId",
    });
    expect(strategic!.title.length).toBeGreaterThan(4);
    expect(strategic!.rationale?.length ?? 0).toBeGreaterThan(9);
    expect(strategic!.expectedGain?.length ?? 0).toBeGreaterThan(4);
    expect(strategic!.riskSummary?.length ?? 0).toBeGreaterThan(4);
    expect(strategic!.confidence).toBeGreaterThanOrEqual(0);
    expect(strategic!.confidence).toBeLessThanOrEqual(100);

    // Le centre lit `approvals` : rien n'y figure qui ne soit réellement à décider.
    expect(
      center.pending.every((item) => item.targetId.length > 0),
    ).toBe(true);
    expect(center.history).toEqual([]);
  }, 60_000);

  it("removes a decided proposal from the queue and records it in history", async () => {
    const { services, owner, tenant } =
      await setupTenantWithProposals("decision");

    const before = await services.getApprovalCenter(owner.id, tenant.id);
    const target = before.pending.find((item) => item.kind === "strategic")!;

    await services.decideStrategicRecommendation(owner.id, tenant.id, {
      recommendationId: target.targetId,
      decision: "approved",
      reason: "Validé pour préparation, sans exécution automatique.",
    });

    const after = await services.getApprovalCenter(owner.id, tenant.id);
    expect(after.pending.map((item) => item.targetId)).not.toContain(
      target.targetId,
    );
    expect(after.pending.length).toBe(before.pending.length - 1);

    expect(after.history.length).toBe(1);
    expect(after.history[0]).toMatchObject({
      kind: "strategic",
      kindLabel: "Décision stratégique",
      title: target.title,
      decision: "approved",
      reason: "Validé pour préparation, sans exécution automatique.",
    });
  }, 60_000);

  it("hides every proposal from a role that cannot decide", async () => {
    const { db, services, tenant } = await setupTenantWithProposals("role");

    const collaborator = await services.registerUser({
      name: "Collaborateur Validations",
      email: "collaborateur.validations@example.com",
      password: "Password!1",
    });
    await db.query(
      "insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, $3, $4)",
      [tenant.id, collaborator.id, "collaborator", new Date().toISOString()],
    );

    const view = await services.getApprovalCenter(collaborator.id, tenant.id);
    expect(view).toEqual({ canApprove: false, pending: [], history: [] });
  }, 60_000);

  it("never exposes another organisation's proposals", async () => {
    const first = await setupTenantWithProposals("iso-a");
    const second = await setupTenantWithProposals("iso-b");

    const firstTargets = (
      await first.services.getApprovalCenter(first.owner.id, first.tenant.id)
    ).pending.map((item) => item.targetId);
    const secondTargets = (
      await second.services.getApprovalCenter(second.owner.id, second.tenant.id)
    ).pending.map((item) => item.targetId);

    expect(firstTargets.length).toBeGreaterThan(0);
    expect(secondTargets.length).toBeGreaterThan(0);
    expect(
      firstTargets.some((targetId) => secondTargets.includes(targetId)),
    ).toBe(false);

    await expect(
      first.services.getApprovalCenter(first.owner.id, second.tenant.id),
    ).rejects.toMatchObject({ code: "approval_center_access_denied" });
  }, 60_000);
});
