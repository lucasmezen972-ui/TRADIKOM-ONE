import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { pgPoolAsSqlClient } from "../src/db/client";
import { migrate } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  issueWhatsAppTwilioActivationAuthorization,
  registerAuthorizedWhatsAppEndpoint,
} from "../src/modules/channels";

const databaseUrl = process.env.DATABASE_URL;
const describeIfPostgres = databaseUrl ? describe : describe.skip;
const ownerPools: Pool[] = [];
const restrictedPools: Pool[] = [];
const restrictedRoles: Array<{ ownerPool: Pool; roleName: string }> = [];
const authorizedAt = "2026-08-08T16:00:00.000Z";
const expiresAt = "2026-08-08T17:00:00.000Z";

afterEach(async () => {
  await Promise.all(restrictedPools.splice(0).map((pool) => pool.end()));
  for (const role of restrictedRoles.splice(0)) {
    await dropRestrictedRole(role.ownerPool, role.roleName);
  }
  await Promise.all(ownerPools.splice(0).map((pool) => pool.end()));
});

describeIfPostgres("RLS PostgreSQL des autorisations d'activation OS-5", () => {
  it("isole select, insert, update et delete par tenant", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });
    const fixtureA = await seedAuthorizationTenant(ownerDb, "a");
    const fixtureB = await seedAuthorizationTenant(ownerDb, "b");

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);

    expect(
      (
        await restrictedPool.query(
          "select id from channel_provider_activation_authorizations",
        )
      ).rows,
    ).toEqual([]);
    const visibleA = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          "select id from channel_provider_activation_authorizations order by id",
        ),
    );
    expect(visibleA.rows).toEqual([{ id: fixtureA.authorizationId }]);

    await expect(
      withTenantContext(restrictedPool, fixtureA.tenantId, (client) =>
        client.query(
          `insert into channel_provider_activation_authorizations (
             id, tenant_id, provider, endpoint_id, authorization_scope,
             max_messages, free_units_confirmed, idempotency_key_hash,
             authorized_by, authorized_at, expires_at, revoked_at, revoked_by
           ) values (
             'authorization_cross_insert', $1, 'whatsapp_twilio', $2,
             'twilio_whatsapp_sandbox', 1, true, $3, $4, $5, $6, null, null
           )`,
          [
            fixtureB.tenantId,
            fixtureB.endpointId,
            "c".repeat(64),
            fixtureB.ownerId,
            authorizedAt,
            expiresAt,
          ],
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);

    const crossUpdate = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          `update channel_provider_activation_authorizations
           set revoked_at = $1, revoked_by = $2
           where tenant_id = $3 and id = $4 returning id`,
          [
            "2026-08-08T16:30:00.000Z",
            fixtureB.ownerId,
            fixtureB.tenantId,
            fixtureB.authorizationId,
          ],
        ),
    );
    expect(crossUpdate.rows).toEqual([]);
    const crossDelete = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          `delete from channel_provider_activation_authorizations
           where tenant_id = $1 and id = $2 returning id`,
          [fixtureB.tenantId, fixtureB.authorizationId],
        ),
    );
    expect(crossDelete.rows).toEqual([]);
  });
});

type OwnerDb = ReturnType<typeof pgPoolAsSqlClient>;

async function seedAuthorizationTenant(db: OwnerDb, suffix: "a" | "b") {
  const services = createServices(db);
  const owner = await services.registerUser({
    name: `Activation RLS ${suffix}`,
    email: `activation-rls-${suffix}-${randomUUID()}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Activation RLS ${suffix} ${randomUUID()}`,
    category: "Services",
  });
  const endpoint = await registerAuthorizedWhatsAppEndpoint(
    db,
    {
      tenantId: tenant.id,
      actorId: owner.id,
      externalAccountId: `AC${suffix.repeat(32)}`,
      destinationAddress: `whatsapp:+59669600000${suffix === "a" ? "1" : "2"}`,
      occurredAt: authorizedAt,
    },
    "activation-postgres-fingerprint-secret-32-bytes",
  );
  const authorization = await issueWhatsAppTwilioActivationAuthorization(db, {
    tenantId: tenant.id,
    actorId: owner.id,
    endpointId: endpoint.endpointId,
    idempotencyKey: `activation-rls-${suffix}`,
    maxMessages: 1,
    freeUnitsConfirmed: true,
    expiresAt,
    occurredAt: authorizedAt,
  });
  return {
    ownerId: owner.id,
    tenantId: tenant.id,
    endpointId: endpoint.endpointId,
    authorizationId: authorization.authorizationId,
  };
}

async function createRestrictedRole(ownerPool: Pool) {
  if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
  const roleName = `tradikom_activation_rls_${randomUUID().replaceAll("-", "")}`;
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
