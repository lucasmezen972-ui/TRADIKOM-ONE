import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createMemoryDb, migrate, type DbClient } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { readTenantAsset } from "../src/modules/assets/service";
import type { AssetStorage } from "../src/modules/assets/storage";
import type { SqlTransactionContext } from "../src/db/client";

it("reads a private asset only inside the verified member's tenant under the limited runtime role", async () => {
  const db = await createMemoryDb();
  try {
    const services = createServices(db);
    const actor = await services.registerUser({ name: "Fixture image privée", email: "private-asset@example.test", password: "FixturePassword!1" });
    const otherActor = await services.registerUser({ name: "Fixture autre image", email: "other-private-asset@example.test", password: "FixturePassword!1" });
    const tenant = await services.createTenant(actor.id, { name: "Entreprise image privée", category: "Services" });
    const foreign = await services.createTenant(otherActor.id, { name: "Entreprise image tierce", category: "Services" });
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    for (const [assetId, tenantId, actorId] of [["asset_private_fixture", tenant.id, actor.id], ["asset_foreign_fixture", foreign.id, otherActor.id]]) {
      await db.query(`insert into tenant_assets
        (id, tenant_id, kind, content_type, byte_size, checksum, storage_key, original_name, uploaded_by, created_at)
        values ($1,$2,'section_image','image/png',4,$3,$4,'fixture.png',$5,$6)`,
      [assetId, tenantId, checksum, `fixture/${assetId}`, actorId, new Date().toISOString()]);
    }
    const read = vi.fn(async () => bytes);
    const storage: AssetStorage = {
      name: "memory-private-fixture", read,
      put: async () => { throw new Error("No upload in this fixture"); },
      remove: async () => { throw new Error("No deletion in this fixture"); },
    };
    await migrate(db, { enableRls: true });
    await db.exec(`create role private_asset_owner; create role private_asset_runtime;
      alter table tenants owner to private_asset_owner;
      alter table memberships owner to private_asset_owner;
      alter table tenant_assets owner to private_asset_owner;
      grant usage on schema public to private_asset_runtime;
      grant select on all tables in schema public to private_asset_runtime;
      set role private_asset_runtime`);
    const contexts: SqlTransactionContext[] = [];
    const runtime = {
      __runtime: "postgres",
      query: (sql: string, params?: unknown[]) => db.query(sql, params),
      __withTransaction: (context: SqlTransactionContext, callback: (tx: DbClient) => Promise<unknown>) => db.transaction(async tx => {
        contexts.push(context);
        if (context.tenantId) await tx.query("select set_config('app.tenant_id', $1, true)", [context.tenantId]);
        if (context.actorId) await tx.query("select set_config('app.actor_id', $1, true)", [context.actorId]);
        if (context.systemAccess) throw new Error("System access forbidden in private asset test");
        return callback({ __runtime: "postgres", __transaction: true, query: (sql: string, params?: unknown[]) => tx.query(sql, params) } as DbClient);
      }),
    } as unknown as DbClient;
    expect((await runtime.query("select rolsuper, rolbypassrls from pg_roles where rolname=current_user")).rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    expect((await runtime.query("select * from tenant_assets")).rows).toHaveLength(0);
    const asset = await readTenantAsset(runtime, actor.id, tenant.id, "asset_private_fixture", storage);
    expect(asset?.bytes).toEqual(bytes);
    expect(asset?.contentType).toBe("image/png");
    expect(read).toHaveBeenCalledExactlyOnceWith("fixture/asset_private_fixture");
    expect(await readTenantAsset(runtime, actor.id, tenant.id, "asset_foreign_fixture", storage)).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    await expect(readTenantAsset(runtime, actor.id, foreign.id, "asset_foreign_fixture", storage)).rejects.toMatchObject({ code: "tenant_access_denied" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(contexts).toEqual([
      { tenantId: tenant.id, actorId: actor.id },
      { tenantId: tenant.id, actorId: actor.id },
      { tenantId: foreign.id, actorId: actor.id },
    ]);
    expect((await runtime.query("select * from tenant_assets")).rows).toHaveLength(0);
    expect((await runtime.query("select nullif(current_setting('app.tenant_id',true),'') as tenant, nullif(current_setting('app.actor_id',true),'') as actor")).rows[0]).toEqual({ tenant: null, actor: null });
    await db.exec("reset role");
  } finally { await db.close(); }
});
