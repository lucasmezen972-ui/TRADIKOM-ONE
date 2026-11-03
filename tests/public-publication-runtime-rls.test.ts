import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createMemoryDb, migrate, type DbClient } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { readPublicAsset } from "../src/modules/assets/service";
import type { AssetStorage } from "../src/modules/assets/storage";
import { getPublishedSite } from "../src/modules/websites/service";
import { GET } from "../src/app/fichiers/[assetId]/route";
import PublicSitePage from "../src/app/sites/[slug]/page";

const boundary = vi.hoisted(() => ({ readPublicAsset: vi.fn(), getPublishedSite: vi.fn() }));
vi.mock("../src/lib/services", () => ({ getServices: async () => boundary }));
vi.mock("../src/app/actions", () => ({ submitSiteLeadAction: vi.fn() }));
vi.mock("../src/lib/session", () => ({ getCurrentSession: async () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("PUBLIC_SITE_NOT_FOUND"); } }));

it("sert uniquement le dernier snapshot publié et ses images sans ouvrir les tables au rôle anonyme", async () => {
  const db = await createMemoryDb();
  try {
    const { createServices } = await vi.importActual<typeof import("../src/lib/services")>("../src/lib/services");
    const services = createServices(db);
    const actor = await services.registerUser({ name: "Fixture Public", email: "fixture-public@example.test", password: "FixturePassword!1" });
    const tenant = await services.createTenant(actor.id, { name: "Fixture Publique", category: "Services" });
    const otherTenant = await services.createTenant(actor.id, { name: "Fixture Autre", category: "Services" });
    await services.saveOnboarding(actor.id, tenant.id, defaultGarageOnboarding());
    await services.saveOnboarding(actor.id, otherTenant.id, defaultGarageOnboarding());
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 1, 1]);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const assets = { published: "asset_public_fixture", disabled: "asset_disabled_fixture", draft: "asset_draft_fixture", foreign: "asset_foreign_fixture", replacement: "asset_replacement_fixture" };
    for (const assetId of Object.values(assets)) {
      await db.query(`insert into tenant_assets
        (id, tenant_id, kind, content_type, byte_size, checksum, storage_key, original_name, uploaded_by, created_at)
        values ($1,$2,'section_image','image/png',$3,$4,$5,'fixture.png',$6,$7)`,
      [assetId,assetId === assets.foreign ? otherTenant.id : tenant.id,bytes.byteLength,checksum,`fixture/${assetId}`,actor.id,new Date().toISOString()]);
    }
    const readStorage = vi.fn(async (key: string) => Object.values(assets).some(id => key === `fixture/${id}`) ? bytes : null);
    const storage: AssetStorage = {
      name: "fixture-memory-only", put: async () => { throw new Error("No upload in this fixture"); },
      remove: async () => { throw new Error("No deletion in this fixture"); }, read: readStorage,
    };
    const workspace = await services.getWebsiteWorkspace(actor.id, tenant.id);
    const hero = workspace.sections[0]!;
    const update = (sectionId: string, imageId: string, enabled: boolean, title: string) => services.updateWebsiteSection(actor.id, tenant.id, sectionId, {
      title, body: "Contenu public de recette", imageUrl: `/fichiers/${imageId}`, enabled,
    });
    await update(hero.id, assets.published, true, "Titre publié immuable");
    await update(workspace.sections[1]!.id, assets.disabled, false, "Texte désactivé privé");
    await services.publishWebsite(actor.id, tenant.id);
    // Corrupt only this trusted local historical snapshot to check the public
    // broker's defence in depth; the current publisher rejects this reference.
    await db.query(`update website_versions
      set snapshot = pg_catalog.jsonb_set(pg_catalog.jsonb_set(snapshot::jsonb,
        '{sections,2,imageUrl}', pg_catalog.to_jsonb($2::text), true),
        '{sections,2,enabled}', 'true'::jsonb, true)::text
      where id = (select version_id from website_publications
        where tenant_id=$1 order by published_at desc,id desc limit 1)`,
    [tenant.id, `/fichiers/${assets.foreign}`]);
    await update(hero.id, assets.draft, true, "Brouillon privé après publication");

    await migrate(db, { enableRls: true });
    const brokerMigration = await readFile(new URL("../src/db/migrations/0129_public_website_read_brokers.sql", import.meta.url), "utf8");
    await db.exec("create role tradikom_app");
    await expect(db.exec(brokerMigration)).rejects.toThrow("public_website_owner_required");
    await db.exec(`create role tradikom_owner; create role tradikom_web_preview;
      create role anon; create role authenticated; create role service_role;
      alter table tenants owner to tradikom_owner;
      alter table tenant_assets owner to tradikom_owner;
      alter table websites owner to tradikom_owner;
      alter table website_publications owner to tradikom_owner;
      alter table website_versions owner to tradikom_owner;
      grant usage on schema public to tradikom_owner, tradikom_web_preview;
      grant select on all tables in schema public to tradikom_web_preview`);
    // Reapply the exact mirror with the production role names already present,
    // as they are when the dedicated migration identity runs in PostgreSQL.
    await db.exec(brokerMigration);
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await db.query<{ site: boolean; asset: boolean; schema: boolean }>(
        `select has_function_privilege($1, 'app_private.app_public_site_by_slug(text)', 'EXECUTE') as site,
          has_function_privilege($1, 'app_private.app_public_asset_by_id(text)', 'EXECUTE') as asset,
          has_schema_privilege($1,'app_private','USAGE') as schema`, [role],
      )).rows[0]).toEqual({ site: false, asset: false, schema: false });
    }
    for (const role of ["tradikom_app", "tradikom_web_preview"]) {
      expect((await db.query<{ site: boolean; asset: boolean }>(
        `select has_function_privilege($1, 'app_private.app_public_site_by_slug(text)', 'EXECUTE') as site,
          has_function_privilege($1, 'app_private.app_public_asset_by_id(text)', 'EXECUTE') as asset`, [role],
      )).rows[0]).toEqual({ site: true, asset: true });
    }
    const brokers = await db.query<{ owner: string; security_definer: boolean; config: string[] }>(
      `select pg_get_userbyid(p.proowner) as owner, p.prosecdef as security_definer, p.proconfig as config
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='app_private'
         and p.proname in ('app_public_site_by_slug','app_public_asset_by_id') order by p.proname`,
    );
    expect(brokers.rows).toHaveLength(2);
    for (const broker of brokers.rows) expect(broker).toEqual({ owner: "tradikom_owner", security_definer: true, config: ['search_path=""'] });
    await db.exec("set role tradikom_web_preview");
    const runtime: DbClient = { query: (sql, params) => db.query(sql, params) };
    const identity = await runtime.query<{ superuser: boolean; bypass: boolean }>("select rolsuper as superuser, rolbypassrls as bypass from pg_roles where rolname=current_user");
    expect(identity.rows[0]).toEqual({ superuser: false, bypass: false });
    for (const table of ["tenants", "tenant_assets", "website_versions", "website_publications", "business_profiles"]) {
      expect((await runtime.query(`select * from ${table}`)).rows).toHaveLength(0);
    }
    boundary.readPublicAsset.mockImplementation(assetId => readPublicAsset(runtime, assetId, storage));
    boundary.getPublishedSite.mockImplementation(slug => getPublishedSite(runtime, slug));
    const route = (assetId: string) => GET(new Request(`https://app.example.test/fichiers/${assetId}`), { params: Promise.resolve({ assetId }) });

    const response = await route(assets.published);
    expect.soft(response.status).toBe(200);
    if (response.status === 200) expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    const site = await getPublishedSite(runtime, tenant.slug);
    expect.soft(site?.sections[0]?.title).toBe("Titre publié immuable");
    if (site) {
      expect(site.tenant).toEqual({ id: tenant.id, slug: tenant.slug });
      expect(JSON.stringify(site)).not.toContain("Brouillon privé");
      expect(JSON.stringify(site)).not.toContain("Texte désactivé privé");
      const html = renderToStaticMarkup(await PublicSitePage({ params: Promise.resolve({ slug: tenant.slug }) }));
      expect(html).toContain("Titre publié immuable");
      expect(html).not.toContain("Brouillon privé");
    }
    for (const assetId of [assets.disabled, assets.draft, assets.foreign, assets.replacement, "unknown"]) {
      const before = readStorage.mock.calls.length;
      expect.soft((await route(assetId)).status).toBe(404);
      expect.soft(readStorage.mock.calls.length).toBe(before);
    }
    expect(await getPublishedSite(runtime, otherTenant.slug)).toBeNull();
    await expect(PublicSitePage({ params: Promise.resolve({ slug: otherTenant.slug }) })).rejects.toThrow("PUBLIC_SITE_NOT_FOUND");
    expect(await getPublishedSite(runtime, "unknown-slug")).toBeNull();
    expect(await getPublishedSite(runtime, "' OR true --")).toBeNull();
    expect((await route("' OR true --")).status).toBe(404);
    expect((await runtime.query("select current_setting('app.system_access',true) as setting")).rows[0]).not.toEqual({ setting: "true" });
    expect((await runtime.query("select * from tenant_assets")).rows).toHaveLength(0);

    await db.exec("reset role");
    await update(hero.id, assets.replacement, true, "Nouvelle publication");
    await services.publishWebsite(actor.id, tenant.id);
    await db.exec("set role tradikom_web_preview");
    expect((await route(assets.published)).status).toBe(404);
    expect((await route(assets.replacement)).status).toBe(200);
    expect((await getPublishedSite(runtime, tenant.slug))?.sections[0]?.title).toBe("Nouvelle publication");
    await db.exec("reset role");
    // There is no unpublish product action: deletion of the publication is an
    // isolated DB fixture for the boundary, never a provider operation.
    await db.query("delete from website_publications where tenant_id = $1", [tenant.id]);
    await db.exec("set role tradikom_web_preview");
    expect(await getPublishedSite(runtime, tenant.slug)).toBeNull();
    expect((await route(assets.replacement)).status).toBe(404);
    expect((await runtime.query("select * from tenant_assets")).rows).toHaveLength(0);
    await db.exec("reset role");
  } finally { await db.close(); }
});
