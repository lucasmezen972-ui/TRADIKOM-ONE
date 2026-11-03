import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { migrate } from "../src/lib/db";

it("refuse une usurpation système par une table temporaire après mise à niveau", async () => {
  const db = new PGlite();
  try {
    await migrate(db, {
      enableRls: true,
      targetMigrationId: "123_os5_conversation_action_plan_delegations_rls",
    });
    await db.exec(`
      create role search_path_attacker;
      grant usage on schema public to search_path_attacker;
      set role search_path_attacker;
      create temp table pg_class (relowner oid, oid oid);
      insert into pg_temp.pg_class
        select (select oid from pg_catalog.pg_roles where rolname='search_path_attacker'),
               'public.tenants'::regclass::oid;
      set app.system_access='true';
    `);
    // The old unqualified catalog lookup trusts the attacker's temporary table.
    expect((await db.query<{ allowed: boolean }>(
      "select public.app_is_system() as allowed",
    )).rows[0].allowed).toBe(true);
    await db.exec("reset role");
    await migrate(db, { enableRls: true });
    await migrate(db, { enableRls: true });
    await db.exec("set role search_path_attacker");
    expect((await db.query<{ allowed: boolean }>(
      "select public.app_is_system() as allowed",
    )).rows[0].allowed).toBe(false);
    await db.exec("reset role");
    const missing = await db.query<{ count: number }>(`
      select count(*)::int as count from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind='f'
        and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
        and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) c
          where c like 'search_path=%')
    `);
    expect(missing.rows[0].count).toBe(0);
  } finally {
    await db.close();
  }
});
