import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createMemoryDb, migrate, type DbClient } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { createRequestScopedDb } from "../src/db/request-client";
import { withTenantDbTransaction } from "../src/db/tenant-context";
import type { SqlTransactionContext } from "../src/db/client";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { readPublicAsset, readTenantAsset, uploadTenantAsset } from "../src/modules/assets/service";
import type { AssetStorage } from "../src/modules/assets/storage";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG5kAAAAASUVORK5CYII=", "base64"));
const image = (marker = 0) => new Uint8Array([...png, marker]);
type Runtime = DbClient & { __runtime: "postgres"; __withTransaction: <T>(context: SqlTransactionContext, callback: (tx: DbClient) => Promise<T>) => Promise<T> };

async function setup() {
  const db = await createMemoryDb();
  const services = createServices(db);
  const owner = await services.registerUser({ name: "Fixture image PostgreSQL", email: "postgres-image@example.test", password: "FixturePassword!1" });
  const outsider = await services.registerUser({ name: "Fixture image tierce", email: "postgres-image-other@example.test", password: "FixturePassword!1" });
  const tenant = await services.createTenant(owner.id, { name: "Entreprise images PostgreSQL", category: "Services" });
  const foreign = await services.createTenant(outsider.id, { name: "Entreprise images tierce", category: "Services" });
  await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
  await migrate(db, { enableRls: true });
  await db.exec(`create role tradikom_owner; create role tradikom_app; create role tradikom_web_preview;
    create role anon; create role authenticated; create role service_role;
    do $$ declare r record; begin
      for r in select tablename from pg_tables where schemaname='public' loop
        execute format('alter table public.%I owner to tradikom_owner',r.tablename);
      end loop;
    end $$;
    grant usage on schema public to tradikom_owner,tradikom_web_preview;
    grant select,insert,update,delete on all tables in schema public to tradikom_web_preview;
    grant truncate on public.tenant_assets to tradikom_web_preview`);
  await db.exec(await readFile(new URL("../src/db/migrations/0129_public_website_read_brokers.sql", import.meta.url), "utf8"));
  await db.exec("set role tradikom_web_preview");
  const contexts: SqlTransactionContext[] = [];
  const runtime: Runtime = {
    __runtime: "postgres", query: <T>(sql: string, params?: unknown[]) => db.query<T>(sql, params),
    __withTransaction: <T>(context: SqlTransactionContext, callback: (tx: DbClient) => Promise<T>) => db.transaction(async tx => {
      contexts.push(context);
      if (context.systemAccess) throw new Error("System access is forbidden for image persistence");
      if (context.tenantId) await tx.query("select set_config('app.tenant_id',$1,true)", [context.tenantId]);
      if (context.actorId) await tx.query("select set_config('app.actor_id',$1,true)", [context.actorId]);
      return callback({ __runtime: "postgres", __transaction: true,
        query: <R>(sql: string, params?: unknown[]) => tx.query<R>(sql, params),
      } as DbClient);
    }),
  };
  const api = createServices(createRequestScopedDb(runtime, { actorId: owner.id, tenantId: tenant.id }));
  const asOwner = async <T>(callback: () => Promise<T>) => {
    await db.exec("reset role");
    try { return await callback(); } finally { await db.exec("set role tradikom_web_preview"); }
  };
  const usage = () => asOwner(async () => (await db.query<{ scope_key: string; bytes: string; count: string }>("select scope_key,used_bytes::text as bytes,used_count::text as count from app_private.tenant_asset_usage order by scope_key")).rows);
  return { db, runtime, api, owner, outsider, tenant, foreign, contexts, asOwner, usage };
}

it("persists immutable image bytes and serves only authorised private or published content with a limited SQL role", async () => {
  const h = await setup();
  try {
    const { db, runtime, api, owner, outsider, tenant, foreign, asOwner } = h;
    expect((await runtime.query("select rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const forbidden: AssetStorage = { name: "no-file-or-provider", put: vi.fn(async () => { throw new Error("No storage transport allowed"); }), read: vi.fn(async () => { throw new Error("No storage transport allowed"); }), remove: vi.fn(async () => { throw new Error("No storage transport allowed"); }) };
    const bytes = image();
    const uploaded = await api.uploadTenantAsset(owner.id, tenant.id, { kind: "section_image", originalName: "../../fixture.png", bytes });
    expect(uploaded.originalName).toBe("fixture.png");
    expect(await api.uploadTenantAsset(owner.id, tenant.id, { kind: "section_image", originalName: "fixture.png", bytes })).toEqual(uploaded);
    expect((await asOwner(() => db.query("select count(*)::int as count from audit_logs where tenant_id=$1 and action='asset.uploaded'", [tenant.id]))).rows[0]).toEqual({ count: 1 });
    expect(await h.usage()).toEqual([
      { scope_key: "global", bytes: String(bytes.byteLength), count: "1" },
      { scope_key: `tenant:${tenant.id}`, bytes: String(bytes.byteLength), count: "1" },
    ]);
    expect((await readTenantAsset(runtime, owner.id, tenant.id, uploaded.id, forbidden))?.bytes).toEqual(bytes);
    expect(await readPublicAsset(runtime, uploaded.id, forbidden)).toBeNull();
    await expect(readTenantAsset(runtime, outsider.id, tenant.id, uploaded.id, forbidden)).rejects.toMatchObject({ code: "tenant_access_denied" });
    await expect(readTenantAsset(runtime, owner.id, foreign.id, uploaded.id, forbidden)).rejects.toMatchObject({ code: "tenant_access_denied" });
    const listings = await api.getTenantAssets(owner.id, tenant.id);
    expect(listings).toHaveLength(1);
    expect(Object.keys(listings[0]!)).not.toContain("content_bytes");
    const queries: string[] = [];
    const metadataDb: DbClient = { query: async <T>(sql: string, params?: unknown[]) => { queries.push(sql); return createRequestScopedDb(runtime, { actorId: owner.id, tenantId: tenant.id }).query<T>(sql, params); } };
    await createServices(metadataDb).getTenantAssets(owner.id, tenant.id);
    expect(queries.every(sql => !sql.includes("content_bytes") && !/select\s+\*/i.test(sql))).toBe(true);
    await expect(runtime.query("select * from app_private.tenant_asset_usage")).rejects.toMatchObject({ code: "42501" });
    await expect(runtime.query("select app_private.enforce_tenant_asset_storage()")).rejects.toMatchObject({ code: "42501" });
    expect((await runtime.query("select has_table_privilege(current_user,'public.tenant_assets','TRUNCATE') as allowed")).rows[0]).toEqual({ allowed: false });
    expect((await runtime.query("select * from tenant_assets")).rows).toHaveLength(0);
    const beforeConflict = await h.usage();
    await withTenantDbTransaction(runtime, tenant.id, owner.id, tx => tx.query("insert into tenant_assets select * from tenant_assets where id=$1 on conflict do nothing", [uploaded.id]));
    expect(await h.usage()).toEqual(beforeConflict);
    await expect(withTenantDbTransaction(runtime, tenant.id, owner.id, tx => tx.query("update tenant_assets set original_name='changed.png' where id=$1", [uploaded.id]))).rejects.toThrow("asset_immutable");
    const workspace = await api.getWebsiteWorkspace(owner.id, tenant.id);
    const hero = workspace.sections.find(section => section.type === "hero")!;
    await api.updateWebsiteSection(owner.id, tenant.id, hero.id, { title: hero.title, body: hero.body, enabled: true, imageUrl: uploaded.url });
    await api.publishWebsite(owner.id, tenant.id);
    expect((await readPublicAsset(runtime, uploaded.id, forbidden))?.bytes).toEqual(bytes);
    await expect(api.deleteTenantAsset(owner.id, tenant.id, uploaded.id)).rejects.toMatchObject({ code: "asset_in_use" });
    await api.updateWebsiteSection(owner.id, tenant.id, hero.id, { title: hero.title, body: hero.body, enabled: true, imageUrl: "" });
    await api.publishWebsite(owner.id, tenant.id);
    expect(await readPublicAsset(runtime, uploaded.id, forbidden)).toBeNull();
    await api.deleteTenantAsset(owner.id, tenant.id, uploaded.id);
    expect(await h.usage()).toEqual([{ scope_key: "global", bytes: "0", count: "0" }]);
    expect(forbidden.put).not.toHaveBeenCalled(); expect(forbidden.read).not.toHaveBeenCalled(); expect(forbidden.remove).not.toHaveBeenCalled();
    expect(h.contexts.every(context => !context.systemAccess)).toBe(true);
    expect((await runtime.query("select nullif(current_setting('app.tenant_id',true),'') as tenant,nullif(current_setting('app.actor_id',true),'') as actor")).rows[0]).toEqual({ tenant: null, actor: null });
  } finally { await h.db.close(); }
});

it("enforces tenant/global byte and count quotas atomically, accepts a replay at capacity, and validates raw content", async () => {
  const h = await setup();
  try {
    const { db, api, owner, outsider, tenant, foreign, asOwner } = h;
    const existing = await api.uploadTenantAsset(owner.id, tenant.id, { kind: "logo", originalName: "logo.png", bytes: image() });
    const realUsage = await h.usage();
    for (const [scope, field, cap] of [[`tenant:${tenant.id}`, "used_bytes", 10 * 1024 * 1024], [`tenant:${tenant.id}`, "used_count", 64], ["global", "used_bytes", 50 * 1024 * 1024], ["global", "used_count", 512]] as const) {
      await asOwner(() => db.query(`update app_private.tenant_asset_usage set ${field}=$1 where scope_key=$2`, [cap, scope]));
      const fullUsage = await h.usage();
      expect(await api.uploadTenantAsset(owner.id, tenant.id, { kind: "logo", originalName: "logo.png", bytes: image() })).toEqual(existing);
      await expect(api.uploadTenantAsset(owner.id, tenant.id, { kind: "logo", originalName: "new.png", bytes: image(1) })).rejects.toMatchObject({ code: "asset_quota_exceeded" });
      expect(await h.usage()).toEqual(fullUsage);
      await asOwner(async () => { for (const row of realUsage) await db.query("update app_private.tenant_asset_usage set used_bytes=$1,used_count=$2 where scope_key=$3", [row.bytes,row.count,row.scope_key]); });
    }
    const correctChecksum = createHash("sha256").update(png).digest("hex");
    for (const [size, checksum, mime] of [
      [png.byteLength, "0".repeat(64), "image/png"],
      [png.byteLength + 1, correctChecksum, "image/png"],
      [png.byteLength, correctChecksum, "image/jpeg"],
    ] as const) {
      const invalidId = "asset_invalid_payload_fixture";
      await expect(asOwner(() => db.query(`insert into tenant_assets
        (id,tenant_id,kind,content_type,byte_size,checksum,storage_key,original_name,uploaded_by,created_at,storage_backend,content_bytes)
        values ($1,$2,'logo',$9,$3,$4,$5,'invalid.png',$6,$7,'postgres',$8)`,
      [invalidId,tenant.id,size,checksum,`dbasset:${tenant.id}:${invalidId}`,owner.id,new Date().toISOString(),png,mime]))).rejects.toMatchObject({ constraint: "tenant_assets_storage_payload_valid" });
    }
    const tooLarge = new Uint8Array(3 * 1024 * 1024 + 1);
    tooLarge.set(png);
    await expect(asOwner(() => db.query(`insert into tenant_assets
      (id,tenant_id,kind,content_type,byte_size,checksum,storage_key,original_name,uploaded_by,created_at,storage_backend,content_bytes)
      values ('asset_sql_size_fixture',$1,'logo','image/png',$2,$3,$4,'large.png',$5,$6,'postgres',$7)`,
    [tenant.id,tooLarge.byteLength,createHash("sha256").update(tooLarge).digest("hex"),`dbasset:${tenant.id}:asset_sql_size_fixture`,owner.id,new Date().toISOString(),tooLarge]))).rejects.toThrow("asset_storage_invalid");
    expect(await h.usage()).toEqual(realUsage);
    await asOwner(() => db.query(`insert into tenant_assets
      (id,tenant_id,kind,content_type,byte_size,checksum,storage_key,original_name,uploaded_by,created_at)
      values ('asset_legacy_large_fixture',$1,'logo','image/png',$2,$3,'legacy/external.png','legacy.png',$4,$5)`,
    [tenant.id,4 * 1024 * 1024,"a".repeat(64),owner.id,new Date().toISOString()]));
    expect((await asOwner(() => db.query("select storage_backend,content_bytes is null as no_payload,byte_size from tenant_assets where id='asset_legacy_large_fixture'"))).rows[0]).toEqual({ storage_backend: "external", no_payload: true, byte_size: 4 * 1024 * 1024 });
    await asOwner(() => db.query("delete from tenant_assets where id='asset_legacy_large_fixture'"));
    expect(await h.usage()).toEqual(realUsage);
    const foreignApi = createServices(createRequestScopedDb(h.runtime, { actorId: outsider.id, tenantId: foreign.id }));
    await foreignApi.uploadTenantAsset(outsider.id, foreign.id, { kind: "logo", originalName: "foreign.png", bytes: image(2) });
    await asOwner(() => db.query("delete from tenants where id=$1", [foreign.id]));
    expect(await h.usage()).toEqual(realUsage);
    expect((await asOwner(() => db.query("select count(*)::int as count from tenant_assets where tenant_id=$1", [tenant.id]))).rows[0]).toEqual({ count: 1 });
  } finally { await h.db.close(); }
});

it("rolls back payload, quota and audit together if the upload audit fails", async () => {
  const h = await setup();
  try {
    const before = await h.usage();
    const failed: Runtime = { ...h.runtime, __withTransaction: (context, callback) => h.runtime.__withTransaction(context, tx => callback({ ...tx,
      query: <T>(sql: string, params?: unknown[]) => sql.includes("insert into audit_logs") ? Promise.reject(new Error("audit_fixture_unavailable")) : tx.query<T>(sql, params),
    })) };
    await expect(uploadTenantAsset(failed, h.owner.id, h.tenant.id, { kind: "logo", originalName: "rollback.png", bytes: image() })).rejects.toThrow("audit_fixture_unavailable");
    expect(await h.usage()).toEqual(before);
    expect((await h.asOwner(() => h.db.query("select count(*)::int as count from tenant_assets"))).rows[0]).toEqual({ count: 0 });
  } finally { await h.db.close(); }
});
