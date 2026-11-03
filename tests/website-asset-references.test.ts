import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import type { WebsiteSection } from "../src/lib/types";
import { AssetError } from "../src/modules/assets/errors";
import { deleteTenantAsset, uploadTenantAsset } from "../src/modules/assets/service";
import type { AssetStorage } from "../src/modules/assets/storage";
import {
  getWebsiteWorkspace,
  publishWebsite,
  restoreWebsiteVersion,
  updateWebsiteSection,
} from "../src/modules/websites/service";

const opened: Awaited<ReturnType<typeof createMemoryDb>>[] = [];
const unsplashUrl = "https://images.unsplash.com/photo-fixture?auto=format&fit=crop&w=1400";
const noExternalStorage: AssetStorage = {
  name: "forbidden-external-fixture",
  put: async () => { throw new Error("External upload forbidden in this fixture"); },
  read: async () => { throw new Error("External read forbidden in this fixture"); },
  remove: async () => { throw new Error("External deletion forbidden in this fixture"); },
};

afterEach(async () => {
  await Promise.all(opened.splice(0).map(db => db.close()));
});

// Real local SQL transactions verify service ordering and atomicity. They do
// not establish PostgreSQL concurrency behavior or hosted provider behavior.
describe("tenant-owned website asset references", () => {
  it("rejects foreign or missing images, locks before association and rolls back an audit failure", async () => {
    const f = await fixture();
    const hero = await findHero(f);

    // The same actor owns both tenants: this must fail on the image's tenant,
    // rather than being hidden by a missing membership on the foreign tenant.
    for (const imageUrl of [f.foreignAsset.url, "/fichiers/asset_missing_fixture"]) {
      await expectAssetRefusalWithoutMutation(f.db, f.tenant.id, () =>
        updateWebsiteSection(f.db, f.owner.id, f.tenant.id, hero.id, sectionInput(hero, imageUrl)),
      );
    }

    await updateWebsiteSection(f.db, f.owner.id, f.tenant.id, hero.id, sectionInput(hero, unsplashUrl));
    expect((await findHero(f)).imageUrl).toBe(unsplashUrl);

    const association = observeQueries(f.db);
    await updateWebsiteSection(association.db, f.owner.id, f.tenant.id, hero.id, sectionInput(hero, f.asset.url));
    expect((await findHero(f)).imageUrl).toBe(f.asset.url);
    const begin = association.events.findIndex(event => event.sql === "begin");
    const lock = association.events.findIndex(isTenantLock);
    const lookup = association.events.findIndex(isAssetLookup);
    const update = association.events.findIndex(event => /^update (?:public\.)?website_sections\b/.test(event.sql));
    const commit = association.events.findIndex(event => event.sql === "commit");
    expect.soft(begin).toBeGreaterThanOrEqual(0);
    expect.soft(lock).toBeGreaterThan(begin);
    expect.soft(lookup).toBeGreaterThan(lock);
    expect.soft(update).toBeGreaterThan(lookup);
    expect.soft(commit).toBeGreaterThan(update);
    expect.soft(association.events[lock]?.params).toEqual([f.tenant.id]);
    expect.soft(association.events[lookup]?.params).toEqual([f.tenant.id, f.asset.id]);
    expect.soft(association.events[lookup]?.sql).not.toMatch(/\bcontent_bytes\b/);

    const beforeFailure = await websiteState(f.db, f.tenant.id);
    const failingAudit = observeQueries(f.db, event => {
      if (/^insert into audit_logs\b/.test(event.sql) && event.params[3] === "website.section_updated") {
        throw new Error("fixture_website_audit_failure");
      }
    });
    await expect(updateWebsiteSection(
      failingAudit.db, f.owner.id, f.tenant.id, hero.id,
      { ...sectionInput(hero, f.asset.url), title: "Titre qui doit être annulé" },
    )).rejects.toThrow("fixture_website_audit_failure");
    expect.soft(failingAudit.events.some(event => event.sql === "rollback")).toBe(true);
    expect.soft(await websiteState(f.db, f.tenant.id)).toEqual(beforeFailure);
  }, 60_000);

  it("refuses stale images before publication or restoration can replace the site's state", async () => {
    const f = await fixture();
    const hero = await findHero(f);
    await updateWebsiteSection(f.db, f.owner.id, f.tenant.id, hero.id, sectionInput(hero, f.asset.url));
    const historicalVersionId = (await getWebsiteWorkspace(f.db, f.owner.id, f.tenant.id)).website?.currentVersionId;
    expect(historicalVersionId).toBeTruthy();
    await updateWebsiteSection(f.db, f.owner.id, f.tenant.id, hero.id, sectionInput(hero, unsplashUrl));
    await deleteTenantAsset(f.db, f.owner.id, f.tenant.id, f.asset.id, noExternalStorage);
    expect((await f.db.query("select id from tenant_assets where id=$1", [f.asset.id])).rows).toHaveLength(0);

    const restoration = observeQueries(f.db);
    await expectAssetRefusalWithoutMutation(f.db, f.tenant.id, () =>
      restoreWebsiteVersion(restoration.db, f.owner.id, f.tenant.id, historicalVersionId!),
    );
    expect.soft(restoration.events.findIndex(isTenantLock)).toBeGreaterThanOrEqual(0);
    expect.soft(restoration.events.findIndex(isAssetLookup)).toBeGreaterThan(restoration.events.findIndex(isTenantLock));
    expect.soft(restoration.events.some(event => /^delete from (?:public\.)?website_sections\b/.test(event.sql))).toBe(false);

    // Reconstruct a legacy stale draft directly in the local fixture. The
    // publisher must validate it instead of making the missing image public.
    const currentHero = await findHero(f);
    await updateWebsiteSection(f.db, f.owner.id, f.tenant.id, currentHero.id, sectionInput(currentHero, unsplashUrl));
    await f.db.query("update website_sections set image_url=$1 where tenant_id=$2 and id=$3", [f.asset.url, f.tenant.id, currentHero.id]);
    const publication = observeQueries(f.db);
    await expectAssetRefusalWithoutMutation(f.db, f.tenant.id, () =>
      publishWebsite(publication.db, f.owner.id, f.tenant.id),
    );
    expect.soft(publication.events.findIndex(isTenantLock)).toBeGreaterThanOrEqual(0);
    expect.soft(publication.events.findIndex(isAssetLookup)).toBeGreaterThan(publication.events.findIndex(isTenantLock));
    expect.soft(publication.events.some(event => /^insert into (?:public\.)?website_(?:versions|publications)\b/.test(event.sql))).toBe(false);
  }, 60_000);
});

async function fixture() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: "Fixture références image", email: "website-asset-fixture@example.test",
    password: `FixturePassword!${randomUUID()}`,
  });
  const tenant = await services.createTenant(owner.id, { name: "Site image fictif", category: "Services" });
  const foreign = await services.createTenant(owner.id, { name: "Autre site fictif", category: "Services" });
  await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const asset = await uploadTenantAsset(db, owner.id, tenant.id, { kind: "section_image", originalName: "fixture.png", bytes });
  const foreignAsset = await uploadTenantAsset(db, owner.id, foreign.id, { kind: "section_image", originalName: "foreign-fixture.png", bytes });
  return { db, owner, tenant, asset, foreignAsset };
}

async function findHero(f: Awaited<ReturnType<typeof fixture>>) {
  const workspace = await getWebsiteWorkspace(f.db, f.owner.id, f.tenant.id);
  const hero = workspace.sections.find(section => section.type === "hero");
  expect(hero).toBeDefined();
  return hero!;
}

function sectionInput(section: WebsiteSection, imageUrl: string) {
  return { title: section.title, body: section.body, imageUrl, buttonLabel: section.buttonLabel, buttonHref: section.buttonHref, enabled: section.enabled };
}

async function expectAssetRefusalWithoutMutation(db: DbClient, tenantId: string, operation: () => Promise<unknown>) {
  const before = await websiteState(db, tenantId);
  let caught: unknown;
  try { await operation(); } catch (error) { caught = error; }
  expect.soft(caught).toBeInstanceOf(AssetError);
  expect.soft(caught).toMatchObject({ code: "asset_not_found" });
  expect.soft(await websiteState(db, tenantId)).toEqual(before);
}

async function websiteState(db: DbClient, tenantId: string) {
  const sections = await db.query("select * from website_sections where tenant_id=$1 order by id", [tenantId]);
  const websites = await db.query("select * from websites where tenant_id=$1 order by id", [tenantId]);
  const versions = await db.query("select * from website_versions where tenant_id=$1 order by id", [tenantId]);
  const publications = await db.query("select * from website_publications where tenant_id=$1 order by id", [tenantId]);
  const audits = await db.query("select * from audit_logs where tenant_id=$1 order by id", [tenantId]);
  return { sections: sections.rows, websites: websites.rows, versions: versions.rows, publications: publications.rows, audits: audits.rows };
}

type QueryEvent = { sql: string; params: unknown[] };
function isTenantLock(event: QueryEvent) {
  return /^select\b.*\bfrom (?:public\.)?tenants\b.*\bfor update\b/.test(event.sql);
}
function isAssetLookup(event: QueryEvent) {
  return /^select\b.*\bfrom (?:public\.)?tenant_assets\b/.test(event.sql);
}
function observeQueries(db: DbClient, inspect?: (event: QueryEvent) => void) {
  const events: QueryEvent[] = [];
  let active = false;
  const observed: DbClient = {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      if (active) throw new Error("Concurrent query on one fixture connection");
      active = true;
      const event = { sql: sql.toLowerCase().replace(/\s+/g, " ").trim(), params: [...params] };
      events.push(event);
      try {
        inspect?.(event);
        return await db.query<T>(sql, params);
      } finally { active = false; }
    },
  };
  return { db: observed, events };
}
