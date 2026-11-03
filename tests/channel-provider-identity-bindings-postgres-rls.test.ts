import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { pgPoolAsSqlClient } from "../src/db/client";
import { migrate } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  registerAuthorizedMetaWhatsAppEndpoint,
  reserveMetaWhatsAppIdentityBinding,
} from "../src/modules/channels";

const databaseUrl = process.env.DATABASE_URL;
const describeIfPostgres = databaseUrl ? describe : describe.skip;
const ownerPools: Pool[] = [];
const restrictedPools: Pool[] = [];
const restrictedRoles: Array<{ ownerPool: Pool; roleName: string }> = [];
const fingerprintSecret = "postgres-meta-binding-fingerprint-secret-32-bytes";
const timestamp = "2026-08-19T17:00:00.000Z";

afterEach(async () => {
  await Promise.all(restrictedPools.splice(0).map((pool) => pool.end()));
  for (const role of restrictedRoles.splice(0)) {
    await dropRestrictedRole(role.ownerPool, role.roleName);
  }
  await Promise.all(ownerPools.splice(0).map((pool) => pool.end()));
});

describeIfPostgres("RLS PostgreSQL des liaisons Meta endpoint-identité", () => {
  it("isole lecture, insertion, mise à jour et suppression par tenant", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });
    const services = createServices(ownerDb);
    const fixtureA = await seedBinding(ownerDb, services, "a");
    const fixtureB = await seedBinding(ownerDb, services, "b");

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);

    expect(
      (await restrictedPool.query("select id from channel_provider_identity_bindings"))
        .rows,
    ).toEqual([]);
    const ownRows = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          "select id from channel_provider_identity_bindings order by id",
        ),
    );
    expect(ownRows.rows).toEqual([{ id: fixtureA.bindingId }]);
    const crossRows = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          "select id from channel_provider_identity_bindings where id = $1",
          [fixtureB.bindingId],
        ),
    );
    expect(crossRows.rows).toEqual([]);

    const crossUpdate = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          `update channel_provider_identity_bindings
           set endpoint_id = $1
           where tenant_id = $2 and id = $3
           returning id`,
          [fixtureA.endpointId, fixtureB.tenantId, fixtureB.bindingId],
        ),
    );
    expect(crossUpdate.rows).toEqual([]);
    const crossDelete = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          `delete from channel_provider_identity_bindings
           where tenant_id = $1 and id = $2 returning id`,
          [fixtureB.tenantId, fixtureB.bindingId],
        ),
    );
    expect(crossDelete.rows).toEqual([]);
    await expect(
      withTenantContext(restrictedPool, fixtureA.tenantId, (client) =>
        client.query(
          `insert into channel_provider_identity_bindings (
             id, tenant_id, provider, endpoint_id, channel_identity_id, created_at
           ) values ($1, $2, 'whatsapp_meta', $3, $4, $5)`,
          [
            "binding_rls_cross",
            fixtureB.tenantId,
            fixtureB.endpointId,
            fixtureB.identityId,
            timestamp,
          ],
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });
});

type OwnerDb = ReturnType<typeof pgPoolAsSqlClient>;
type Services = ReturnType<typeof createServices>;

async function seedBinding(
  db: OwnerDb,
  services: Services,
  suffix: "a" | "b",
) {
  const owner = await services.registerUser({
    name: `RLS liaison Meta ${suffix}`,
    email: `rls-meta-binding-${suffix}-${randomUUID()}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Organisation RLS Meta ${suffix} ${randomUUID()}`,
    category: "Services",
  });
  const endpoint = await registerAuthorizedMetaWhatsAppEndpoint(
    db,
    {
      tenantId: tenant.id,
      actorId: owner.id,
      externalAccountId: suffix === "a" ? "123456789" : "222333444",
      phoneNumberId: suffix === "a" ? "987654321" : "555666777",
    },
    fingerprintSecret,
  );
  const participantId = `participant_rls_meta_${suffix}_${randomUUID()}`;
  const identityId = `identity_rls_meta_${suffix}_${randomUUID()}`;
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ($1, $2, 'customer', null, $3, $3)`,
    [participantId, tenant.id, timestamp],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values ($1, $2, $3, 'messaging', 'whatsapp-meta', $4, null,
       'customer', 'active', $5, $5)`,
    [
      identityId,
      tenant.id,
      participantId,
      `meta_subject_${randomUUID().replaceAll("-", "")}`,
      timestamp,
    ],
  );
  const binding = await reserveMetaWhatsAppIdentityBinding(db, {
    id: `binding_rls_meta_${suffix}_${randomUUID()}`,
    tenantId: tenant.id,
    endpointId: endpoint.endpointId,
    channelIdentityId: identityId,
    createdAt: timestamp,
  });
  return {
    tenantId: tenant.id,
    endpointId: endpoint.endpointId,
    identityId,
    bindingId: binding.row.id,
  };
}

async function createRestrictedRole(ownerPool: Pool) {
  if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
  const roleName = `tradikom_meta_binding_rls_${randomUUID().replaceAll("-", "")}`;
  const password = randomUUID().replaceAll("-", "");
  const roleIdentifier = quoteIdentifier(roleName);
  await ownerPool.query(
    `create role ${roleIdentifier} login password ${quoteLiteral(password)}`,
  );
  await ownerPool.query(`grant usage on schema public to ${roleIdentifier}`);
  await ownerPool.query(
    `grant select, insert, update, delete on all tables in schema public to ${roleIdentifier}`,
  );
  const restrictedUrl = new URL(databaseUrl);
  restrictedUrl.username = roleName;
  restrictedUrl.password = password;
  return { roleName, databaseUrl: restrictedUrl.toString() };
}

async function dropRestrictedRole(ownerPool: Pool, roleName: string) {
  const roleIdentifier = quoteIdentifier(roleName);
  await ownerPool.query(`drop owned by ${roleIdentifier}`);
  await ownerPool.query(`drop role if exists ${roleIdentifier}`);
}

async function withTenantContext<T>(
  pool: Pool,
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
