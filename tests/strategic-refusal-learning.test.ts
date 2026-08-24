import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import { strategicRefusalMuteDays } from "../src/modules/strategic-advisor";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

async function setupAdvisor(suffix: string) {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: `Owner Refus ${suffix}`,
    email: `owner.refus.${suffix}@example.com`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Garage Refus ${suffix}`,
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

  const generated = await services.generateStrategicRecommendations(
    owner.id,
    tenant.id,
  );
  expect(generated.createdIds.length).toBeGreaterThan(0);
  const recommendations = await services.getStrategicAdvisor(owner.id, tenant.id);
  const first = recommendations.find((item) => item.status === "proposed")!;
  return { db, services, owner, tenant, recommendation: first };
}

const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000);

describe("strategic refusal learning", () => {
  it("mutes the rule after a refusal instead of relying on the fingerprint", async () => {
    const { services, owner, tenant, recommendation } =
      await setupAdvisor("sourdine");

    await services.decideStrategicRecommendation(owner.id, tenant.id, {
      recommendationId: recommendation.id,
      decision: "rejected",
      reason: "Priorité différente ce trimestre.",
    });

    const again = await services.generateStrategicRecommendations(
      owner.id,
      tenant.id,
    );
    // Le compteur prouve que c'est bien la sourdine qui a écarté la règle :
    // la vérification de sourdine passe avant la déduplication par empreinte,
    // qui n'est donc jamais atteinte pour cette règle.
    expect(again.mutedCount).toBeGreaterThan(0);

    const after = await services.getStrategicAdvisor(owner.id, tenant.id);
    const sameRule = after.filter(
      (item) =>
        item.ruleKey === recommendation.ruleKey && item.status === "proposed",
    );
    expect(sameRule).toHaveLength(0);
  }, 60_000);

  it("exposes the muted rule with its refusal reason and end date", async () => {
    const { services, owner, tenant, recommendation } =
      await setupAdvisor("affichage");

    const before = await services.getStrategicRuleMutes(owner.id, tenant.id);
    expect(before).toHaveLength(0);

    await services.decideStrategicRecommendation(owner.id, tenant.id, {
      recommendationId: recommendation.id,
      decision: "rejected",
      reason: "Nous traitons ce sujet en interne.",
    });

    const mutes = await services.getStrategicRuleMutes(owner.id, tenant.id);
    const mute = mutes.find((item) => item.ruleKey === recommendation.ruleKey)!;
    expect(mute).toMatchObject({
      title: recommendation.title,
      reason: "Nous traitons ce sujet en interne.",
      decidedByName: owner.name,
      muteDays: strategicRefusalMuteDays,
    });
    expect(new Date(mute.muteEndsAt).getTime()).toBeGreaterThan(
      new Date(mute.decidedAt).getTime(),
    );
  }, 60_000);

  it("stops muting once the window has elapsed", async () => {
    const { services, owner, tenant, recommendation } =
      await setupAdvisor("fenetre");

    await services.decideStrategicRecommendation(owner.id, tenant.id, {
      recommendationId: recommendation.id,
      decision: "rejected",
      reason: "Pas maintenant, revoir plus tard.",
    });

    const later = daysFromNow(strategicRefusalMuteDays + 1);
    const mutesLater = await services.getStrategicRuleMutes(
      owner.id,
      tenant.id,
      { now: later },
    );
    expect(
      mutesLater.some((item) => item.ruleKey === recommendation.ruleKey),
    ).toBe(false);

    const generationLater = await services.generateStrategicRecommendations(
      owner.id,
      tenant.id,
      { now: later },
    );
    expect(generationLater.mutedCount).toBe(0);
  }, 60_000);

  it("reactivates a rule on demand and keeps the refusal in the history", async () => {
    const { services, owner, tenant, recommendation } =
      await setupAdvisor("reactivation");

    await services.decideStrategicRecommendation(owner.id, tenant.id, {
      recommendationId: recommendation.id,
      decision: "rejected",
      reason: "Décision reportée après arbitrage.",
    });

    const lifted = await services.liftStrategicRecommendationMute(
      owner.id,
      tenant.id,
      { ruleKey: recommendation.ruleKey },
    );
    expect(lifted.liftedCount).toBeGreaterThan(0);

    expect(await services.getStrategicRuleMutes(owner.id, tenant.id)).toHaveLength(
      0,
    );

    const generation = await services.generateStrategicRecommendations(
      owner.id,
      tenant.id,
    );
    expect(generation.mutedCount).toBe(0);

    // Le refus reste consultable : seule la sourdine est levée.
    const history = await services.getStrategicAdvisor(owner.id, tenant.id);
    const rejected = history.find((item) => item.id === recommendation.id)!;
    expect(rejected).toMatchObject({
      status: "rejected",
      decisionReason: "Décision reportée après arbitrage.",
    });

    // Une règle qui n'est plus en sourdine ne peut pas être réactivée deux fois.
    await expect(
      services.liftStrategicRecommendationMute(owner.id, tenant.id, {
        ruleKey: recommendation.ruleKey,
      }),
    ).rejects.toMatchObject({ code: "strategic_rule_mute_not_found" });
  }, 60_000);

  it("keeps refusals scoped to their organisation", async () => {
    const first = await setupAdvisor("org-a");
    const second = await setupAdvisor("org-b");

    await first.services.decideStrategicRecommendation(
      first.owner.id,
      first.tenant.id,
      {
        recommendationId: first.recommendation.id,
        decision: "rejected",
        reason: "Sans objet pour notre activité.",
      },
    );

    expect(
      await second.services.getStrategicRuleMutes(
        second.owner.id,
        second.tenant.id,
      ),
    ).toHaveLength(0);

    const secondGeneration =
      await second.services.generateStrategicRecommendations(
        second.owner.id,
        second.tenant.id,
      );
    expect(secondGeneration.mutedCount).toBe(0);

    await expect(
      second.services.liftStrategicRecommendationMute(
        second.owner.id,
        second.tenant.id,
        { ruleKey: first.recommendation.ruleKey },
      ),
    ).rejects.toMatchObject({ code: "strategic_rule_mute_not_found" });
  }, 60_000);
});
