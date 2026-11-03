import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { getMigrationIds, migrate } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import {
  captureFixtureSnapshot,
  prepareFixtureKit,
  verifyFixtureKit,
  type ApplicationSnapshot,
} from "./helpers/application-snapshot-fixture";

it("restores a fictitious format 1 snapshot at schema 132, then upgrades and replays 135 without losing rows", async () => {
  // Build this historical schema from migrations, never from a user's backup.
  const source = new PGlite();
  let sourceClosed = false;
  let restored: PGlite | undefined;
  let prepared: Awaited<ReturnType<typeof prepareFixtureKit>> | undefined;
  try {
    await migrate(source, { enableRls: true, targetMigrationId: "132_github_public_connectors_rls" });
    const services = createServices(source);
    const actor = await services.registerUser({
      name: "Fixture restauration historique",
      email: "legacy-restore-fixture@example.test",
      password: "FixturePassword!1",
    });
    const tenant = await services.createTenant(actor.id, {
      name: "Entreprise fictive historique",
      category: "Services",
    });
    await services.saveOnboarding(actor.id, tenant.id, defaultGarageOnboarding());
    await source.exec(`
      create role tradikom_owner;
      create role tradikom_app;
      create role tradikom_web_preview;
      create role anon;
      create role authenticated;
      create role service_role;
      do $$ declare item record; begin
        for item in select tablename from pg_tables where schemaname='public' loop
          execute format('alter table public.%I owner to tradikom_owner', item.tablename);
        end loop;
      end $$;
      grant usage on schema public to tradikom_owner, tradikom_app;
      grant select,insert,update,delete on all tables in schema public to tradikom_app;
      grant tradikom_owner to tradikom_app with admin false, inherit false, set false;
      grant tradikom_app to tradikom_web_preview with admin false, inherit true, set false;
      alter role tradikom_web_preview set search_path to pg_catalog, public;
    `);
    expect((await source.query("select nspname from pg_namespace where nspname='app_private'")).rows).toEqual([]);
    const journal = (await source.query<{ id: string; applied_at: string }>(
      "select id,applied_at from public.schema_migrations order by id",
    )).rows;
    expect(journal).toHaveLength(132);
    expect(journal.at(-1)?.id).toBe("132_github_public_connectors_rls");
    const retainedTables = [
      "users", "tenants", "memberships", "business_profiles", "websites",
      "website_sections", "website_versions", "audit_logs",
    ];
    const retainedRows = new Map<string, unknown[]>();
    for (const table of retainedTables) {
      retainedRows.set(table, (await source.query<{ row: unknown }>(
        `select to_jsonb(t) as row from public."${table}" t order by to_jsonb(t)::text`,
      )).rows.map(result => result.row));
    }
    expect(retainedRows.get("users")).toHaveLength(1);
    expect(retainedRows.get("memberships")).toHaveLength(1);
    expect(retainedRows.get("business_profiles")).toHaveLength(1);

    const captured = await captureFixtureSnapshot(source);
    expect(captured.format_version).toBe(2);
    expect(captured.schemas?.map(schema => schema.name)).toEqual(["public"]);
    expect(captured.tables.every(table => table.schema === "public")).toBe(true);
    expect(captured.functions.every(fn => fn.schema === "public")).toBe(true);
    // Change only the historical envelope: rows, definitions, owners and ACLs
    // remain those exported from the real schema 132 fixture above.
    const legacy: ApplicationSnapshot = structuredClone(captured);
    legacy.format_version = 1;
    legacy.scope = "public application schema; excludes platform internals and secret values";
    legacy.schema_acl = captured.schemas!.find(schema => schema.name === "public")!.acl;
    delete legacy.schemas;
    for (const table of legacy.tables) delete table.schema;
    for (const fn of legacy.functions) delete fn.schema;
    expect(legacy.tables.map(table => table.data_xml)).toEqual(captured.tables.map(table => table.data_xml));
    expect(legacy.functions.map(fn => fn.definition)).toEqual(captured.functions.map(fn => fn.definition));

    prepared = await prepareFixtureKit(legacy);
    // Keep only one embedded PostgreSQL engine open during each restore.
    await source.close();
    sourceClosed = true;
    const restoredDb = new PGlite();
    restored = restoredDb;
    await restoredDb.exec(prepared.sql);
    expect((await restoredDb.query("select id,applied_at from public.schema_migrations order by id")).rows).toEqual(journal);
    for (const table of retainedTables) {
      expect((await restoredDb.query<{ row: unknown }>(
        `select to_jsonb(t) as row from public."${table}" t order by to_jsonb(t)::text`,
      )).rows.map(result => result.row)).toEqual(retainedRows.get(table));
    }
    expect((await restoredDb.query("select nspname from pg_namespace where nspname='app_private'")).rows).toEqual([]);

    await migrate(restoredDb, { enableRls: true });
    const upgradedJournal = (await restoredDb.query<{ id: string; applied_at: string }>(
      "select id,applied_at from public.schema_migrations order by id",
    )).rows;
    expect(upgradedJournal.map(row => row.id)).toEqual(getMigrationIds(true));
    expect(upgradedJournal.at(-1)?.id).toBe("135_public_website_read_brokers");
    const historicalIds = new Set(journal.map(row => row.id));
    expect(upgradedJournal.filter(row => historicalIds.has(row.id))).toEqual(journal);
    await migrate(restoredDb, { enableRls: true });
    expect((await restoredDb.query("select id,applied_at from public.schema_migrations order by id")).rows).toEqual(upgradedJournal);
    for (const table of retainedTables) {
      expect((await restoredDb.query<{ row: unknown }>(
        `select to_jsonb(t) as row from public."${table}" t order by to_jsonb(t)::text`,
      )).rows.map(result => result.row)).toEqual(retainedRows.get(table));
    }
    expect((await restoredDb.query("select nspname from pg_namespace where nspname='app_private'")).rows).toEqual([{ nspname: "app_private" }]);
    await restoredDb.close();
    restored = undefined;

    // The independent verifier restores the un-upgraded format 1 kit into
    // another empty local engine and checks all rows, metadata and runtime RLS.
    const proof = await verifyFixtureKit(prepared.kit);
    expect(proof).toMatchObject({
      formatVersion: 1,
      schemas: ["public"],
      restoredTables: legacy.tables.length,
      allRowsExact: true,
      migrationJournalExact: true,
      tableOwnersRlsPoliciesAndAclsExact: true,
      functionDefinitionsOwnersAndAclsExact: true,
      schemaAndDefaultPrivilegesExact: true,
      schemaOwnersExact: false,
      restoredCustomRolesWithoutLoginOrBypass: true,
      roleMembershipsExact: true,
      restrictedRoleAndContextReset: true,
    });
  } finally {
    if (!sourceClosed) await source.close();
    await restored?.close();
    await prepared?.cleanup();
  }
}, 120_000);
