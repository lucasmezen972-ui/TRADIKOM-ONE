import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

async function setupTenant(suffix: string) {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: `Owner Seuil ${suffix}`,
    email: `owner.seuil.${suffix}@example.com`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Garage Seuil ${suffix}`,
    category: "Garage automobile",
  });
  await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
  await services.publishWebsite(owner.id, tenant.id);
  await services.submitPublicLead(tenant.slug, {
    name: `Client Seuil ${suffix}`,
    email: `client.seuil.${suffix}@example.com`,
    phone: "+596 696 44 55 66",
    message: "Demande de devis seuil",
  });
  return { db, services, owner, tenant };
}

/**
 * Le lead planifie une relance à J+1. Quatre jours plus tard, l'opportunité est
 * bloquée avec un seuil de 2 jours mais pas avec le seuil par défaut de 7 :
 * c'est exactement ce que le réglage doit changer.
 */
const fourDaysLater = () => new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);

describe("tenant preferences", () => {
  it("defaults to seven days and applies the configured threshold", async () => {
    const { services, owner, tenant } = await setupTenant("defaut");
    expect(tenant.stalledOpportunityDays).toBe(7);
    expect(tenant.strategicMuteDays).toBe(30);

    const now = fourDaysLater();
    const withDefault = await services.getOpportunities(owner.id, tenant.id, {
      stalled: true,
      now,
    });
    expect(withDefault.opportunities).toHaveLength(0);

    const dashboardWithDefault = await services.getDashboard(
      owner.id,
      tenant.id,
      { now },
    );
    expect(dashboardWithDefault.metrics.stalledOpportunities).toBe(0);
    expect(dashboardWithDefault.tenant.stalledOpportunityDays).toBe(7);

    const updated = await services.updateTenantPreferences(
      owner.id,
      tenant.id,
      { stalledOpportunityDays: 2 },
    );
    expect(updated.stalledOpportunityDays).toBe(2);

    const withShorterThreshold = await services.getOpportunities(
      owner.id,
      tenant.id,
      { stalled: true, now },
    );
    expect(withShorterThreshold.opportunities.length).toBeGreaterThan(0);

    const dashboardAfter = await services.getDashboard(owner.id, tenant.id, {
      now,
    });
    expect(dashboardAfter.metrics.stalledOpportunities).toBeGreaterThan(0);
    expect(dashboardAfter.tenant.stalledOpportunityDays).toBe(2);
    expect(dashboardAfter.commandCenter.stalledOpportunities.length)
      .toBeGreaterThan(0);
  }, 60_000);

  it("accepts a string from a form and refuses values outside the bounds", async () => {
    const { services, owner, tenant } = await setupTenant("bornes");

    // Le formulaire envoie une chaîne : le schéma la convertit.
    const updated = await services.updateTenantPreferences(owner.id, tenant.id, {
      stalledOpportunityDays: "30",
    });
    expect(updated.stalledOpportunityDays).toBe(30);

    for (const invalid of [0, 91, 4.5, "abc"]) {
      await expect(
        services.updateTenantPreferences(owner.id, tenant.id, {
          stalledOpportunityDays: invalid,
        }),
      ).rejects.toMatchObject({ code: "invalid_tenant_preference" });
    }

    // Un refus ne change rien en base.
    const context = await services.getTenantContext(owner.id, tenant.id);
    expect(context?.tenant.stalledOpportunityDays).toBe(30);
  }, 60_000);

  it("reserves the setting to owners and administrators", async () => {
    const { db, services, owner, tenant } = await setupTenant("roles");
    const member = await services.registerUser({
      name: "Membre Seuil",
      email: "membre.seuil@example.com",
      password: "Password!1",
    });
    await db.query(
      "insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, $3, $4)",
      [tenant.id, member.id, "manager", new Date().toISOString()],
    );

    await expect(
      services.updateTenantPreferences(member.id, tenant.id, {
        stalledOpportunityDays: 3,
      }),
    ).rejects.toMatchObject({ code: "tenant_access_denied" });

    const context = await services.getTenantContext(member.id, tenant.id);
    expect(context?.tenant.stalledOpportunityDays).toBe(7);

    // Le propriétaire, lui, peut le régler.
    await services.updateTenantPreferences(owner.id, tenant.id, {
      stalledOpportunityDays: 3,
    });
    const afterOwner = await services.getTenantContext(member.id, tenant.id);
    expect(afterOwner?.tenant.stalledOpportunityDays).toBe(3);
  }, 60_000);

  it("records a real change in the audit log and ignores a no-op save", async () => {
    const { services, owner, tenant } = await setupTenant("audit");

    await services.updateTenantPreferences(owner.id, tenant.id, {
      stalledOpportunityDays: 14,
    });
    const afterChange = await services.getAuditLogs(owner.id, tenant.id);
    const entries = afterChange.filter(
      (log) => log.action === "organization.preferences_updated",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.metadata).toMatchObject({
      field: "stalledOpportunityDays",
      previousValue: 7,
      nextValue: 14,
    });

    await services.updateTenantPreferences(owner.id, tenant.id, {
      stalledOpportunityDays: 14,
    });
    const afterNoop = await services.getAuditLogs(owner.id, tenant.id);
    expect(
      afterNoop.filter(
        (log) => log.action === "organization.preferences_updated",
      ),
    ).toHaveLength(1);
  }, 60_000);
});

describe("strategic mute duration", () => {
  it("shortens the mute window when the organisation reduces it", async () => {
    const { services, owner, tenant } = await setupTenant("sourdine");
    await services.createBusinessBrainEntry(owner.id, tenant.id, {
      domain: "objectives",
      title: "Developper les contrats recurrents",
      summary: "Signer dix contrats recurrents avant la fin du trimestre.",
      details: "Cible validee par la direction.",
      confidence: 88,
      sourceType: "manual",
      evidenceType: "document",
      evidenceSummary: "Compte-rendu de la revue trimestrielle.",
    });
    await services.generateStrategicRecommendations(owner.id, tenant.id);
    const recommendations = await services.getStrategicAdvisor(
      owner.id,
      tenant.id,
    );
    const proposed = recommendations.find((item) => item.status === "proposed")!;
    await services.decideStrategicRecommendation(owner.id, tenant.id, {
      recommendationId: proposed.id,
      decision: "rejected",
      reason: "Priorite differente ce trimestre.",
    });

    // A J+10, la sourdine par defaut de 30 jours court encore.
    const tenDaysLater = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const stillMuted = await services.getStrategicRuleMutes(
      owner.id,
      tenant.id,
      { now: tenDaysLater },
    );
    expect(stillMuted.some((item) => item.ruleKey === proposed.ruleKey)).toBe(
      true,
    );
    expect(stillMuted[0]?.muteDays).toBe(30);

    // Ramenee a 5 jours, la meme regle est de nouveau proposable.
    await services.updateTenantPreferences(owner.id, tenant.id, {
      strategicMuteDays: 5,
    });
    const released = await services.getStrategicRuleMutes(owner.id, tenant.id, {
      now: tenDaysLater,
    });
    expect(released.some((item) => item.ruleKey === proposed.ruleKey)).toBe(
      false,
    );

    const generation = await services.generateStrategicRecommendations(
      owner.id,
      tenant.id,
      { now: tenDaysLater },
    );
    expect(generation.mutedCount).toBe(0);
  }, 60_000);

  it("updates only the preference that was submitted", async () => {
    const { services, owner, tenant } = await setupTenant("partiel");

    await services.updateTenantPreferences(owner.id, tenant.id, {
      strategicMuteDays: 60,
    });
    const context = await services.getTenantContext(owner.id, tenant.id);
    // Le seuil d'opportunite bloquee n'a pas ete touche.
    expect(context?.tenant.stalledOpportunityDays).toBe(7);
    expect(context?.tenant.strategicMuteDays).toBe(60);

    const logs = await services.getAuditLogs(owner.id, tenant.id);
    const entries = logs.filter(
      (log) => log.action === "organization.preferences_updated",
    );
    // Un seul champ a change : une seule ligne d'audit.
    expect(entries).toHaveLength(1);
    expect(entries[0]?.metadata).toMatchObject({
      field: "strategicMuteDays",
      previousValue: 30,
      nextValue: 60,
    });
  }, 60_000);

  it("refuses a mute duration outside the bounds", async () => {
    const { services, owner, tenant } = await setupTenant("bornes-sourdine");

    for (const invalid of [0, 366, 2.5, "abc"]) {
      await expect(
        services.updateTenantPreferences(owner.id, tenant.id, {
          strategicMuteDays: invalid,
        }),
      ).rejects.toMatchObject({ code: "invalid_tenant_preference" });
    }
  }, 60_000);
});
