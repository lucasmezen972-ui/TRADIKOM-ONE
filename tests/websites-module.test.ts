import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import {
  getPublishedSite,
  getWebsiteWorkspace,
  publishWebsite,
  restoreWebsiteVersion,
  updateWebsiteSection,
} from "../src/modules/websites";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { db, services: createServices(db) };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("websites module", () => {
  it("keeps published snapshots immutable while drafts and restores change", async () => {
    const { db, services } = await setup();
    const user = await services.registerUser({
      name: "Malia Website",
      email: "malia.website@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Garage Website",
      category: "Garage automobile",
    });

    await services.saveOnboarding(user.id, tenant.id, defaultGarageOnboarding());
    const initialWorkspace = await getWebsiteWorkspace(db, user.id, tenant.id);
    const originalVersionId = initialWorkspace.versions[0]?.id;
    const originalHero = initialWorkspace.sections.find((section) => section.type === "hero");
    expect(originalVersionId).toBeTruthy();
    expect(originalHero).toBeTruthy();

    await publishWebsite(db, user.id, tenant.id);
    const liveBefore = await getPublishedSite(db, tenant.slug);
    expect(liveBefore?.sections[0]?.title).toBe(originalHero?.title);

    await updateWebsiteSection(db, user.id, tenant.id, originalHero!.id, {
      title: "Titre brouillon module",
      body: originalHero!.body,
      imageUrl: originalHero!.imageUrl,
      buttonLabel: originalHero!.buttonLabel,
      buttonHref: originalHero!.buttonHref,
      enabled: true,
    });

    const draft = await getWebsiteWorkspace(db, user.id, tenant.id);
    const draftHero = draft.sections.find((section) => section.type === "hero");
    expect(draftHero?.title).toBe("Titre brouillon module");

    const liveAfterDraft = await getPublishedSite(db, tenant.slug);
    expect(liveAfterDraft?.sections[0]?.title).toBe(originalHero?.title);

    await restoreWebsiteVersion(db, user.id, tenant.id, originalVersionId!);
    const restored = await getWebsiteWorkspace(db, user.id, tenant.id);
    const restoredHero = restored.sections.find((section) => section.type === "hero");
    expect(restored.website?.status).toBe("draft");
    expect(restoredHero?.title).toBe(originalHero?.title);
  });
});
