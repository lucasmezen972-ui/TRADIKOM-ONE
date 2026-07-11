import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { services: createServices(db) };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("publication snapshots", () => {
  it("keeps the live site on the immutable published snapshot while drafts change", async () => {
    const { services } = await setup();
    const user = await services.registerUser({
      name: "Malia",
      email: "malia.snapshots@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Garage Caraibes Auto",
      category: "Garage automobile",
    });

    await services.saveOnboarding(user.id, tenant.id, defaultGarageOnboarding());
    await services.publishWebsite(user.id, tenant.id);
    const liveBefore = await services.getPublishedSite(tenant.slug);
    const hero = liveBefore?.sections.find((section) => section.type === "hero");
    expect(hero?.title).toContain("Garage Caraibes Auto");

    await services.updateWebsiteSection(user.id, tenant.id, hero!.id, {
      title: "Titre brouillon non publié",
      body: hero!.body,
      imageUrl: hero!.imageUrl,
      buttonLabel: hero!.buttonLabel,
      buttonHref: hero!.buttonHref,
      enabled: true,
    });

    const liveAfter = await services.getPublishedSite(tenant.slug);
    const liveHero = liveAfter?.sections.find((section) => section.type === "hero");
    expect(liveHero?.title).toBe(hero?.title);
  });
});
