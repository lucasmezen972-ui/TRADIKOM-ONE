import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import type { SqlClient, SqlTransactionContext } from "../src/db/client";
import { createRequestScopedDb } from "../src/db/request-client";
import { createMemoryDb, migrate, type DbClient } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import { deleteTenantAsset, readPublicAsset } from "../src/modules/assets/service";
import type { AssetStorage } from "../src/modules/assets/storage";

it("refuses an outer transaction before SQL or storage because it cannot own its commit", async () => {
  const query = vi.fn(async () => { throw new Error("SQL must not run"); });
  const remove = vi.fn(async () => {});
  const storage: AssetStorage = {
    name: "nested-transaction-fixture", remove, read: vi.fn(),
    put: async () => { throw new Error("No upload in this fixture"); },
  };
  const nested = { __transaction: true, query } as unknown as DbClient;
  await expect(deleteTenantAsset(nested, "fixture_actor", "fixture_tenant", "fixture_asset", storage)).rejects.toMatchObject({
    code: "asset_transaction_not_supported", message: expect.stringContaining("transaction indépendante"),
  });
  expect(query).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it("keeps the latest published image until republishing, with tenant-only deletion context", async () => {
  const db = await createMemoryDb();
  try {
    const services = createServices(db);
    const actor = await services.registerUser({ name: "Fixture publication", email: "asset-publication@example.test", password: "FixturePassword!1" });
    const other = await services.registerUser({ name: "Fixture autre publication", email: "asset-publication-other@example.test", password: "FixturePassword!1" });
    const tenant = await services.createTenant(actor.id, { name: "Publication image", category: "Services" });
    const foreign = await services.createTenant(other.id, { name: "Publication étrangère", category: "Services" });
    for (const [user, organisation] of [[actor, tenant], [other, foreign]]) {
      await services.saveOnboarding(user.id, organisation.id, defaultGarageOnboarding());
    }
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    for (const assetId of ["asset_published_delete_a", "asset_published_delete_b", "asset_published_delete_unused"]) {
      await db.query(`insert into tenant_assets
        (id, tenant_id, kind, content_type, byte_size, checksum, storage_key, original_name, uploaded_by, created_at)
        values ($1,$2,'section_image','image/png',4,$3,$4,'fixture.png',$5,$6)`,
      [assetId, tenant.id, checksum, `fixture/${assetId}`, actor.id, new Date().toISOString()]);
    }
    const workspace = await services.getWebsiteWorkspace(actor.id, tenant.id);
    const hero = workspace.sections.find(section => section.type === "hero")!;
    const update = (assetId: string) => services.updateWebsiteSection(actor.id, tenant.id, hero.id, {
      title: hero.title, body: hero.body, enabled: true, imageUrl: `/fichiers/${assetId}`,
    });
    await update("asset_published_delete_a");
    await services.publishWebsite(actor.id, tenant.id);
    await update("asset_published_delete_b");
    // A historical copied URL must neither expose A nor retain it. The current
    // publisher now refuses this reference, so inject only this local fixture.
    const foreignWorkspace = await services.getWebsiteWorkspace(other.id, foreign.id);
    const foreignHero = foreignWorkspace.sections.find(section => section.type === "hero")!;
    await services.publishWebsite(other.id, foreign.id);
    await db.query(`update website_versions set snapshot = pg_catalog.jsonb_set(snapshot::jsonb,
      array['sections',$3::text,'imageUrl'], pg_catalog.to_jsonb($2::text), true)::text
      where id = (select version_id from website_publications where tenant_id=$1
        order by published_at desc,id desc limit 1)`,
    [foreign.id,"/fichiers/asset_published_delete_a",String(foreignWorkspace.sections.findIndex(section => section.id === foreignHero.id))]);

    await migrate(db, { enableRls: true });
    await db.exec(`create role tradikom_owner; create role tradikom_web_preview;
      do $$ declare item record; begin
        for item in select tablename from pg_tables where schemaname='public' loop
          execute format('alter table public.%I owner to tradikom_owner', item.tablename);
        end loop;
      end $$;
      grant usage on schema public to tradikom_owner, tradikom_web_preview;
      grant select,insert,update,delete on all tables in schema public to tradikom_web_preview`);
    await db.exec(await readFile(new URL("../src/db/migrations/0129_public_website_read_brokers.sql", import.meta.url), "utf8"));
    await db.exec("set role tradikom_web_preview");
    const contexts: SqlTransactionContext[] = [];
    const traces: { context: SqlTransactionContext; queries: { sql: string; params?: unknown[] }[]; committed: boolean }[] = [];
    let failAudit = false;
    const runtime: SqlClient = {
      __runtime: "postgres",
      query: (sql, params) => db.query(sql, params),
      __withTransaction: async (context, callback) => {
        contexts.push(context);
        const trace = { context, queries: [] as { sql: string; params?: unknown[] }[], committed: false };
        traces.push(trace);
        const result = await db.transaction(async transaction => {
          if (context.systemAccess) throw new Error("System access forbidden in this fixture");
          if (context.tenantId) await transaction.query("select set_config('app.tenant_id',$1,true)", [context.tenantId]);
          if (context.actorId) await transaction.query("select set_config('app.actor_id',$1,true)", [context.actorId]);
          return callback({ __runtime: "postgres", __transaction: true, query: (sql, params) => {
            trace.queries.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
            if (failAudit && sql.startsWith("insert into audit_logs") && params?.[3] === "asset.deleted") {
              throw new Error("fixture_audit_failure");
            }
            return transaction.query(sql, params);
          } });
        });
        trace.committed = true;
        return result;
      },
    };
    const scoped = createRequestScopedDb(runtime, { tenantId: tenant.id, actorId: actor.id }) as DbClient;
    const foreignScoped = createRequestScopedDb(runtime, { tenantId: foreign.id, actorId: other.id }) as DbClient;
    let failStorage = false;
    const remove = vi.fn(async () => {
      const deletion = traces.findLast(trace => trace.queries.some(query => query.sql.startsWith("delete from tenant_assets")));
      expect(deletion?.committed).toBe(true);
      expect(deletion?.queries.some(query => query.sql.startsWith("insert into audit_logs") && query.params?.[3] === "asset.deleted")).toBe(true);
      if (failStorage) throw new Error("fixture_storage_failure");
    });
    const storage: AssetStorage = {
      name: "memory-publication-fixture", read: async () => bytes, remove,
      put: async () => { throw new Error("No upload in this fixture"); },
    };
    expect((await runtime.query("select rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    expect((await runtime.query("select * from tenant_assets")).rows).toHaveLength(0);
    const deniedStart = traces.length;
    await expect(deleteTenantAsset(scoped, other.id, tenant.id, "asset_published_delete_a", storage)).rejects.toMatchObject({ code: "tenant_access_denied" });
    expect(traces.slice(deniedStart).flatMap(trace => trace.queries).some(query => query.sql.endsWith("for update"))).toBe(false);
    await expect(deleteTenantAsset(foreignScoped, other.id, foreign.id, "asset_published_delete_a", storage)).rejects.toMatchObject({ code: "asset_not_found" });
    await expect(deleteTenantAsset(scoped, actor.id, tenant.id, "asset_published_delete_a", storage)).rejects.toMatchObject({
      code: "asset_in_use", message: expect.stringContaining("version publiée"),
    });
    const protectedDeletion = traces.at(-1)!;
    const lockSql = "select id from tenants where id = $1 for update";
    const protectedLock = protectedDeletion.queries.findIndex(query => query.sql === lockSql);
    expect(protectedLock).toBeGreaterThan(0);
    expect(protectedDeletion.queries[protectedLock]?.params).toEqual([tenant.id]);
    expect(protectedDeletion.queries[0]?.sql).toContain("from memberships");
    expect(protectedDeletion.queries.findIndex(query => query.sql.includes("app_private.app_public_site_by_slug"))).toBeGreaterThan(protectedLock);
    expect(protectedDeletion.committed).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    expect(await readPublicAsset(runtime as DbClient, "asset_published_delete_a", storage)).not.toBeNull();

    const publicationStart = traces.length;
    await createServices(scoped).publishWebsite(actor.id, tenant.id);
    expect(traces).toHaveLength(publicationStart + 1);
    const publication = traces.at(-1)!;
    const publicationLock = publication.queries.findIndex(query => query.sql === lockSql);
    expect(publicationLock).toBeGreaterThan(0);
    expect(publication.queries[0]?.sql).toContain("from memberships");
    expect(publication.queries[publicationLock]?.params).toEqual([tenant.id]);
    expect(publication.queries.findIndex(query => query.sql.startsWith("select * from websites"))).toBeGreaterThan(publicationLock);
    expect(publication.queries.findIndex(query => query.sql.startsWith("insert into website_versions"))).toBeGreaterThan(publicationLock);
    expect(publication.committed).toBe(true);

    failAudit = true;
    await expect(deleteTenantAsset(scoped, actor.id, tenant.id, "asset_published_delete_a", storage)).rejects.toThrow("fixture_audit_failure");
    failAudit = false;
    expect(remove).not.toHaveBeenCalled();
    expect((await scoped.query("select id from tenant_assets where id=$1", ["asset_published_delete_a"])).rows).toHaveLength(1);
    expect((await scoped.query("select id from audit_logs where action='asset.deleted' and target_id=$1", ["asset_published_delete_a"])).rows).toHaveLength(0);

    failStorage = true;
    await expect(deleteTenantAsset(scoped, actor.id, tenant.id, "asset_published_delete_unused", storage)).rejects.toThrow("fixture_storage_failure");
    failStorage = false;
    expect((await scoped.query("select id from tenant_assets where id=$1", ["asset_published_delete_unused"])).rows).toHaveLength(0);
    expect((await scoped.query("select id from audit_logs where action='asset.deleted' and target_id=$1", ["asset_published_delete_unused"])).rows).toHaveLength(1);
    // The other tenant's copied publication URL must not block this deletion.
    expect(await deleteTenantAsset(scoped, actor.id, tenant.id, "asset_published_delete_a", storage)).toEqual({ id: "asset_published_delete_a" });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenLastCalledWith("fixture/asset_published_delete_a");
    const deletion = traces.at(-1)!;
    const lock = deletion.queries.findIndex(query => query.sql === lockSql);
    const removedRow = deletion.queries.findIndex(query => query.sql.startsWith("delete from tenant_assets"));
    const audit = deletion.queries.findIndex(query => query.sql.startsWith("insert into audit_logs"));
    expect(lock).toBeGreaterThan(0);
    expect(removedRow).toBeGreaterThan(lock);
    expect(audit).toBeGreaterThan(removedRow);
    expect(deletion.committed).toBe(true);
    expect(await readPublicAsset(runtime as DbClient, "asset_published_delete_a", storage)).toBeNull();
    expect(contexts.length).toBeGreaterThan(0);
    expect(contexts.every(context => !context.systemAccess && (
      (context.tenantId === tenant.id && [actor.id, other.id].includes(context.actorId ?? "")) ||
      (context.tenantId === foreign.id && context.actorId === other.id)
    ))).toBe(true);
    expect((await runtime.query("select * from tenant_assets")).rows).toHaveLength(0);
    expect((await runtime.query("select nullif(current_setting('app.tenant_id',true),'') as tenant, nullif(current_setting('app.actor_id',true),'') as actor, nullif(current_setting('app.system_access',true),'') as system")).rows[0]).toEqual({ tenant: null, actor: null, system: null });
    await db.exec("reset role");
  } finally { await db.close(); }
});
