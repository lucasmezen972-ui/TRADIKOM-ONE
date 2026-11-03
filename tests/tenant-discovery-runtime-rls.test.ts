import * as databaseModule from "../src/lib/db";
import * as security from "../src/lib/security";
import { createRequestScopedDb } from "../src/db/request-client";
import { expect, it, vi } from "vitest";
import { createMemoryDb, migrate, type DbClient } from "../src/lib/db";
import { createServices, getServices } from "../src/lib/services";
import { getUserTenants, getTenantContext } from "../src/modules/tenants/service";
import type { SqlTransactionContext } from "../src/db/client";

it("retrouve les organisations du compte avant sélection du tenant avec le rôle runtime, sans lire celles d’autrui", async () => {
  const db = await createMemoryDb();
  try {
    const services = createServices(db);
    const actor = await services.registerUser({ name: "Découverte", email: "discovery@example.test", password: "FixturePassword!1" });
    const other = await services.registerUser({ name: "Autre", email: "discovery-other@example.test", password: "FixturePassword!1" });
    const first = await services.createTenant(actor.id, { name: "Première", category: "Services" });
    const second = await services.createTenant(actor.id, { name: "Deuxième", category: "Services" });
    const foreign = await services.createTenant(other.id, { name: "Organisation privée tierce", category: "Services" });
    const session = await services.createSession(actor.id);
    await migrate(db, { enableRls: true });
    await db.exec(`create role discovery_owner; create role discovery_runtime;
      alter table tenants owner to discovery_owner; alter table memberships owner to discovery_owner;
      grant discovery_owner to discovery_runtime with inherit false, set false;
      grant usage on schema public to discovery_runtime; grant select on all tables in schema public to discovery_runtime;
      set role discovery_runtime`);
    const runtime = { __runtime: "postgres", query: (sql: string, params?: unknown[]) => db.query(sql, params),
      __withTransaction: (context: SqlTransactionContext, callback: (tx: DbClient) => Promise<unknown>) => db.transaction(async tx => {
        if (context.tenantId) await tx.query("select set_config('app.tenant_id', $1, true)", [context.tenantId]);
        if (context.actorId) await tx.query("select set_config('app.actor_id', $1, true)", [context.actorId]);
        if (context.systemAccess) await tx.query("select set_config('app.system_access', 'true', true)");
        return callback({ __runtime: "postgres", __transaction: true, query: (sql: string, params?: unknown[]) => tx.query(sql, params) } as DbClient);
      }) } as unknown as DbClient;
    expect((await runtime.query("select * from memberships")).rows).toHaveLength(0);
    expect((await getUserTenants(runtime, actor.id)).map(x => x.tenant.id).sort()).toEqual([first.id, second.id].sort());
    expect((await getTenantContext(runtime, actor.id, second.id))?.tenant.id).toBe(second.id);
    expect(await getUserTenants(runtime, "missing-user")).toEqual([]);
    expect((await runtime.query("select * from memberships")).rows).toHaveLength(0);
    const scoped = createRequestScopedDb(runtime, { tenantId: first.id, actorId: actor.id });
    expect((await scoped.query<{ id: string }>("select id from tenants")).rows.map(r => r.id)).toEqual([first.id]);
    expect((await scoped.query("select * from tenants where id = $1", [second.id])).rows).toHaveLength(0);
    expect((await getUserTenants(scoped, actor.id)).map(x => x.tenant.id).sort()).toEqual([first.id, second.id].sort());
    expect((await runtime.query("select * from memberships")).rows).toHaveLength(0);
    expect((await getTenantContext(runtime, actor.id, foreign.id))?.tenant.id).toBe(first.id);
    vi.spyOn(databaseModule, "getDb").mockResolvedValue(runtime);
    vi.spyOn(security, "getSessionIdFromCookie").mockResolvedValue(session.sessionToken);
    vi.spyOn(security, "getTenantIdFromCookie").mockResolvedValue(foreign.id);
    const web = await getServices();
    expect((await web.getTenantContext(actor.id))?.tenant.id).toBe(first.id);
    expect(await web.getDashboard(actor.id, first.id)).toBeDefined();
    await expect(web.switchTenant(actor.id, second.id)).resolves.toBe("owner");
    await expect(web.switchTenant(actor.id, foreign.id)).rejects.toMatchObject({ code: "tenant_access_denied" });
    expect((await runtime.query("select * from memberships")).rows).toHaveLength(0);
    await db.exec("reset role");
    await db.query("update users set deleted_at = $2 where id = $1", [actor.id, new Date().toISOString()]);
    expect(await getUserTenants(runtime, actor.id)).toEqual([]);
  } finally { vi.restoreAllMocks(); await db.close(); }
});
