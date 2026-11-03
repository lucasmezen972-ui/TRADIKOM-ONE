import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { XMLParser } from "fast-xml-parser";
import { expect, it } from "vitest";
import type { SqlClient } from "../src/db/client";
import { withTenantDbTransaction } from "../src/db/tenant-context";
import { migrate, type DbClient } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import { readPublicAsset, readTenantAsset } from "../src/modules/assets/service";
import { captureFixtureSnapshot, prepareFixtureKit, verifyFixtureKit } from "./helpers/application-snapshot-fixture";

// Every identity, hash and byte in this suite is generated from these fixtures.
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG5kAAAAASUVORK5CYII=", "base64"));
const publicBytes = new Uint8Array([...png, 1]);
const privateBytes = new Uint8Array([...png, 2]);
const shadowBytes = new Uint8Array([0, 255, 92, 39, 34, 128]);
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });

it("exports and restores schema 135 payloads, counters and private brokers before replaying migrations without loss", async () => {
  let db = new PGlite();
  let closed = false;
  let stage = "fixture_setup";
  let kit: Awaited<ReturnType<typeof prepareFixtureKit>> | undefined;
  try {
    await migrate(db);
    const services = createServices(db);
    const actor = await services.registerUser({ name: "Fixture restauration", email: "restore-image@example.test", password: "FictitiousPassword!1" });
    const tenant = await services.createTenant(actor.id, { name: "Fixture sauvegarde", category: "Services" });
    await services.saveOnboarding(actor.id, tenant.id, defaultGarageOnboarding());
    await migrate(db, { enableRls: true });
    await db.exec(`create role tradikom_owner; create role tradikom_app noinherit;
      create role tradikom_web_preview inherit; create role anon; create role authenticated; create role service_role;
      grant tradikom_owner to tradikom_app with inherit false, set false;
      grant tradikom_app to tradikom_web_preview with inherit true, set false;
      do $$ declare item record; begin
        for item in select tablename from pg_tables where schemaname='public' loop
          execute format('alter table public.%I owner to tradikom_owner',item.tablename);
        end loop;
      end $$;
      grant usage,create on schema public to tradikom_owner;
      grant usage on schema public to tradikom_app;
      grant select,insert,update,delete on all tables in schema public to tradikom_app;
      alter role tradikom_app set search_path to '';
      alter role tradikom_web_preview set search_path to pg_catalog,public,pg_temp;
      alter role tradikom_web_preview set statement_timeout to '30000';
      alter role tradikom_web_preview set app.fictitious_backup_secret to 'must-not-be-exported'`);
    await db.exec(await readFile(new URL("../src/db/migrations/0129_public_website_read_brokers.sql", import.meta.url), "utf8"));
    const published = await services.uploadTenantAsset(actor.id, tenant.id, { kind: "section_image", originalName: "published.png", bytes: publicBytes });
    const privateAsset = await services.uploadTenantAsset(actor.id, tenant.id, { kind: "logo", originalName: "private.png", bytes: privateBytes });
    const workspace = await services.getWebsiteWorkspace(actor.id, tenant.id);
    const hero = workspace.sections.find(section => section.type === "hero")!;
    await services.updateWebsiteSection(actor.id, tenant.id, hero.id, { title: hero.title, body: hero.body, enabled: true, imageUrl: published.url });
    await services.publishWebsite(actor.id, tenant.id);
    await db.exec(`create table public.backup_fixture_homonym(id text primary key,payload bytea);
      create table app_private.backup_fixture_homonym(id text primary key,payload bytea);
      alter table public.backup_fixture_homonym enable row level security;
      alter table app_private.backup_fixture_homonym enable row level security;
      alter table public.backup_fixture_homonym owner to tradikom_owner;
      alter table app_private.backup_fixture_homonym owner to tradikom_owner;
      create policy backup_fixture_named_roles on public.backup_fixture_homonym for select to tradikom_owner,tradikom_app using(false);
      alter default privileges for role tradikom_owner revoke execute on functions from public;
      alter default privileges for role tradikom_owner in schema app_private grant execute on functions to tradikom_app;
      alter default privileges for role tradikom_owner grant usage on types to tradikom_app;
      alter default privileges for role tradikom_owner grant usage on schemas to tradikom_app`);
    await db.query("insert into public.backup_fixture_homonym values ('public-bytes',$1),('null-bytes',null)", [shadowBytes]);
    await db.query("insert into app_private.backup_fixture_homonym values ('private-bytes',$1)", [new Uint8Array([...shadowBytes, 7])]);
    const expectedUsage = (await db.query("select scope_key,used_bytes::text as bytes,used_count::text as count from app_private.tenant_asset_usage order by scope_key")).rows;
    expect(expectedUsage).toEqual([
      { scope_key: "global", bytes: String(publicBytes.byteLength + privateBytes.byteLength), count: "2" },
      { scope_key: `tenant:${tenant.id}`, bytes: String(publicBytes.byteLength + privateBytes.byteLength), count: "2" },
    ]);
    const expectedJournal = (await db.query("select * from public.schema_migrations order by id")).rows;
    stage = "fixture_export";
    await db.exec("set bytea_output='escape'");
    const snapshot = await captureFixtureSnapshot(db);
    expect(snapshot.format_version).toBe(2);
    expect(snapshot.schemas?.map(schema => schema.name)).toEqual(["app_private", "public"]);
    expect(snapshot).not.toHaveProperty("platform_inventory");
    const defaults = snapshot.default_acls as { schema: string | null; type: string; entries: unknown[] }[];
    expect(defaults.some(acl => acl.schema === "app_private" && acl.type === "f" && acl.entries.length > 0)).toBe(true);
    expect(defaults.some(acl => acl.schema === null && acl.type === "f")).toBe(true);
    expect(defaults.some(acl => acl.schema === null && acl.type === "T")).toBe(true);
    expect(defaults.some(acl => acl.schema === null && acl.type === "n")).toBe(true);
    expect(JSON.stringify(snapshot.roles)).not.toContain("must-not-be-exported");
    expect(snapshot.tables.filter(table => table.name === "backup_fixture_homonym")).toHaveLength(2);
    const assetTable = snapshot.tables.find(table => table.schema === "public" && table.name === "tenant_assets")!;
    const exportedAssets = JSON.parse(parser.parse(assetTable.data_xml).table.row.payload) as { id: string; content_bytes: string }[];
    expect(exportedAssets.find(asset => asset.id === published.id)?.content_bytes).toBe("\\x" + Buffer.from(publicBytes).toString("hex"));
    kit = await prepareFixtureKit(snapshot);
    expect(kit.sql.indexOf('INSERT INTO "app_private"."tenant_asset_usage"')).toBeLessThan(kit.sql.indexOf("CREATE TRIGGER tenant_asset_storage"));
    expect(kit.sql.indexOf('INSERT INTO "public"."tenant_assets"')).toBeLessThan(kit.sql.indexOf("CREATE TRIGGER tenant_asset_storage"));
    await db.close();
    closed = true;
    db = new PGlite();
    closed = false;
    stage = "restore_new_database";
    await db.exec(kit.sql);
    stage = "restored_bytes_and_counters";
    expect((await db.query("select scope_key,used_bytes::text as bytes,used_count::text as count from app_private.tenant_asset_usage order by scope_key")).rows).toEqual(expectedUsage);
    expect((await db.query("select * from public.schema_migrations order by id")).rows).toEqual(expectedJournal);
    expect((await db.query<{ hash: string }>("select encode(sha256(content_bytes),'hex') as hash from public.tenant_assets where id=$1", [published.id])).rows[0]?.hash).toBe(createHash("sha256").update(publicBytes).digest("hex"));
    expect((await db.query<{ payload: Uint8Array }>("select payload from public.backup_fixture_homonym where id='public-bytes'")).rows[0]?.payload).toEqual(shadowBytes);
    expect((await db.query<{ payload: Uint8Array }>("select payload from app_private.backup_fixture_homonym where id='private-bytes'")).rows[0]?.payload).toEqual(new Uint8Array([...shadowBytes, 7]));
    const expectedBrokerAcl = { anon: false, authenticated: false, service_role: false, tradikom_web_preview: true };
    for (const [role, allowed] of Object.entries(expectedBrokerAcl)) {
      expect((await db.query("select has_function_privilege($1,'app_private.app_public_asset_by_id(text)','EXECUTE') as allowed", [role])).rows[0]).toEqual({ allowed });
    }
    stage = "migration_replay";
    const beforeReplay = await captureFixtureSnapshot(db);
    await db.exec("set role tradikom_owner");
    await migrate(db, { enableRls: true });
    await migrate(db, { enableRls: true });
    await db.exec("reset role");
    const afterReplay = await captureFixtureSnapshot(db);
    expect(afterReplay.tables).toEqual(beforeReplay.tables);
    expect(afterReplay.functions).toEqual(beforeReplay.functions);
    expect(afterReplay.schemas).toEqual(beforeReplay.schemas);

    stage = "restricted_runtime_reads";
    const administrator = (await db.query<{ name: string }>("select session_user as name")).rows[0]!.name;
    await db.exec("set session authorization tradikom_web_preview");
    const runtime: SqlClient = {
      __runtime: "postgres", query: (sql, params) => db.query(sql, params),
      __withTransaction: (context, callback) => db.transaction(async tx => {
        if (context.systemAccess) throw new Error("No SYSTEM in restore fixture");
        if (context.tenantId) await tx.query("select set_config('app.tenant_id',$1,true)", [context.tenantId]);
        if (context.actorId) await tx.query("select set_config('app.actor_id',$1,true)", [context.actorId]);
        return callback({ __runtime: "postgres", __transaction: true, query: (sql, params) => tx.query(sql, params) });
      }),
    };
    expect((await runtime.query("select content_bytes from public.tenant_assets")).rows).toHaveLength(0);
    await expect(runtime.query("select * from app_private.tenant_asset_usage")).rejects.toMatchObject({ code: "42501" });
    expect((await readPublicAsset(runtime as DbClient, published.id))?.bytes).toEqual(publicBytes);
    expect(await readPublicAsset(runtime as DbClient, privateAsset.id)).toBeNull();
    expect((await readTenantAsset(runtime as DbClient, actor.id, tenant.id, privateAsset.id))?.bytes).toEqual(privateBytes);
    stage = "restricted_runtime_rollback";
    await expect(withTenantDbTransaction(runtime, tenant.id, actor.id, async tx => {
      await tx.query("delete from public.tenant_assets where tenant_id=$1 and id=$2", [tenant.id, privateAsset.id]);
      throw new Error("fixture_restore_rollback");
    })).rejects.toThrow("fixture_restore_rollback");
    expect((await runtime.query("select nullif(current_setting('app.tenant_id',true),'') as tenant")).rows[0]).toEqual({ tenant: null });
    stage = "post_rollback_accounting";
    // PGlite bootstraps session_authorization with an empty reset value.
    // Return to the exact original identity, never change runtime privileges.
    await db.exec('set session authorization "' + administrator.replaceAll('"', '""') + '"');
    expect((await db.query("select current_user as name")).rows[0]).toEqual({ name: administrator });
    expect((await db.query("select scope_key,used_bytes::text as bytes,used_count::text as count from app_private.tenant_asset_usage order by scope_key")).rows).toEqual(expectedUsage);
    expect((await db.query("select id from public.tenant_assets order by id")).rows).toHaveLength(2);
    await db.close();
    closed = true;
    stage = "independent_verifier";
    const proof = await verifyFixtureKit(kit.kit);
    expect(proof).toMatchObject({ allRowsExact: true, functionDefinitionsOwnersAndAclsExact: true, schemaAndDefaultPrivilegesExact: true, restrictedRoleAndContextReset: true, assetQuotaAccountingExact: true, byteaHexQualified: true, byteaColumnsVerified: 3 });
  } catch (error) {
    if (error instanceof Error) error.message = `${stage}: ${error.message}`;
    throw error;
  } finally {
    if (!closed) await db.close();
    await kit?.cleanup();
  }
}, 180_000);

it("refuses a nonempty target before modifying its application objects or roles", async () => {
  const fixture = new PGlite();
  let fixtureClosed = false;
  let kit: Awaited<ReturnType<typeof prepareFixtureKit>> | undefined;
  let target: PGlite | undefined;
  try {
    await fixture.exec("create role tradikom_owner; create table public.fixture(id text primary key); insert into public.fixture values ('fictitious')");
    kit = await prepareFixtureKit(await captureFixtureSnapshot(fixture));
    await fixture.close();
    fixtureClosed = true;
    const isolated = new PGlite();
    target = isolated;
    await isolated.exec("create schema app_private");
    await expect(isolated.exec(kit.sql)).rejects.toThrow("Restore requires a new empty isolated database");
    await isolated.exec("rollback");
    expect((await isolated.query("select count(*)::int as count from pg_tables where schemaname='public'")).rows[0]).toEqual({ count: 0 });
    expect((await isolated.query("select count(*)::int as count from pg_roles where rolname='tradikom_owner'")).rows[0]).toEqual({ count: 0 });
    await isolated.exec("drop schema app_private; create function public.fixture_sentinel() returns integer language sql as 'select 17'");
    await expect(isolated.exec(kit.sql)).rejects.toThrow("Restore requires a new empty isolated database");
    await isolated.exec("rollback");
    expect((await isolated.query("select public.fixture_sentinel() as sentinel")).rows[0]).toEqual({ sentinel: 17 });
    await isolated.exec("drop function public.fixture_sentinel(); create role tradikom_owner login");
    await expect(isolated.exec(kit.sql)).rejects.toThrow("Restore requires fresh isolated application roles");
    await isolated.exec("rollback");
    expect((await isolated.query("select rolcanlogin from pg_roles where rolname='tradikom_owner'")).rows[0]).toEqual({ rolcanlogin: true });
  } finally {
    if (!fixtureClosed) await fixture.close();
    await target?.close();
    await kit?.cleanup();
  }
}, 60_000);
