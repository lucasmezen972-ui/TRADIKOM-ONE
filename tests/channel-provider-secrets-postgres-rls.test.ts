import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { pgPoolAsSqlClient } from "../src/db/client";
import { migrate } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { id } from "../src/lib/security";
import {
  createChannelProviderSecretKeyring,
  registerAuthorizedMetaWhatsAppEndpoint,
  registerAuthorizedWhatsAppEndpoint,
  rotateMetaWhatsAppEndpointSecret,
  rotateWhatsAppEndpointSecret,
} from "../src/modules/channels";

const databaseUrl = process.env.DATABASE_URL;
const describeIfPostgres = databaseUrl ? describe : describe.skip;
const ownerPools: Pool[] = [];
const restrictedPools: Pool[] = [];
const restrictedRoles: Array<{ ownerPool: Pool; roleName: string }> = [];
const timestamp = "2026-08-08T12:00:00.000Z";

afterEach(async () => {
  await Promise.all(restrictedPools.splice(0).map((pool) => pool.end()));
  for (const role of restrictedRoles.splice(0)) {
    await dropRestrictedRole(role.ownerPool, role.roleName);
  }
  await Promise.all(ownerPools.splice(0).map((pool) => pool.end()));
});

describeIfPostgres("RLS PostgreSQL du coffre fournisseur OS-5", () => {
  it("isole select, insert, update et delete par tenant", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });
    const fixtureA = await seedVaultTenant(ownerDb, "a");
    const fixtureB = await seedVaultTenant(ownerDb, "b", "whatsapp_meta");

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);

    expect(
      (await restrictedPool.query("select id from channel_provider_secret_versions"))
        .rows,
    ).toEqual([]);
    const visibleA = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          "select id from channel_provider_secret_versions order by id",
        ),
    );
    expect(visibleA.rows).toEqual([{ id: fixtureA.secretVersionId }]);

    await expect(
      withTenantContext(restrictedPool, fixtureA.tenantId, (client) =>
        client.query(
          `insert into channel_provider_secret_versions (
             id, tenant_id, provider, endpoint_id, channel_identity_id,
             secret_scope, encrypted_payload, key_version, secret_version,
             rotation_key_hash, revoked_at, revoked_by, created_by, created_at
           ) values (
             'secret_cross_insert', $1, 'whatsapp_twilio', $2, $3,
             'identity', $4, 'test-v1', 1, $5, null, null, $6, $7
           )`,
          [
            fixtureB.tenantId,
            fixtureB.endpointId,
            fixtureB.identityId,
            "x".repeat(80),
            "c".repeat(64),
            fixtureB.ownerId,
            timestamp,
          ],
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);

    const crossUpdate = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          `update channel_provider_secret_versions
           set revoked_at = $1, revoked_by = $2
           where tenant_id = $3 and id = $4 returning id`,
          [timestamp, fixtureB.ownerId, fixtureB.tenantId, fixtureB.secretVersionId],
        ),
    );
    expect(crossUpdate.rows).toEqual([]);
    const crossDelete = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          `delete from channel_provider_secret_versions
           where tenant_id = $1 and id = $2 returning id`,
          [fixtureB.tenantId, fixtureB.secretVersionId],
        ),
    );
    expect(crossDelete.rows).toEqual([]);
  });
});

type OwnerDb = ReturnType<typeof pgPoolAsSqlClient>;

async function seedVaultTenant(
  db: OwnerDb,
  suffix: "a" | "b",
  provider: "whatsapp_twilio" | "whatsapp_meta" = "whatsapp_twilio",
) {
  const services = createServices(db);
  const owner = await services.registerUser({
    name: `Coffre RLS ${suffix}`,
    email: `vault-rls-${suffix}-${randomUUID()}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Coffre RLS ${suffix} ${randomUUID()}`,
    category: "Services",
  });
  const endpoint = provider === "whatsapp_meta"
    ? await registerAuthorizedMetaWhatsAppEndpoint(
        db,
        {
          tenantId: tenant.id,
          actorId: owner.id,
          externalAccountId: "345678901234567",
          phoneNumberId: "456789012345678",
          occurredAt: timestamp,
        },
        "vault-postgres-fingerprint-secret-32-bytes",
      )
    : await registerAuthorizedWhatsAppEndpoint(
        db,
        {
          tenantId: tenant.id,
          actorId: owner.id,
          externalAccountId: `AC${suffix.repeat(32)}`,
          destinationAddress: `whatsapp:+59669600000${suffix === "a" ? "1" : "2"}`,
          occurredAt: timestamp,
        },
        "vault-postgres-fingerprint-secret-32-bytes",
      );
  const participantId = id("participant");
  const identityId = id("identity");
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
     ) values ($1, $2, $3, 'messaging', $4, $5, null,
       'customer', 'active', $6, $6)`,
    [
      identityId,
      tenant.id,
      participantId,
      provider === "whatsapp_meta" ? "whatsapp-meta" : "whatsapp-twilio",
      `vault-rls-subject-${suffix}`,
      timestamp,
    ],
  );
  const keyring = createChannelProviderSecretKeyring({
    activeKeyVersion: "test-v1",
    keys: { "test-v1": Buffer.alloc(32, suffix === "a" ? 31 : 32) },
  });
  const rotated = provider === "whatsapp_meta"
    ? await rotateMetaWhatsAppEndpointSecret(
        db,
        {
          tenantId: tenant.id,
          actorId: owner.id,
          endpointId: endpoint.endpointId,
          rotationKey: `vault-rls-rotation-${suffix}`,
          secret: {
            wabaId: "345678901234567",
            accessToken: "meta-postgres-test-token-never-real",
            phoneNumberId: "456789012345678",
            graphApiVersion: "v23.0",
            appSecret: "meta-postgres-app-secret-never-real",
            webhookVerifyToken: "meta-postgres-webhook-token",
          },
          occurredAt: timestamp,
        },
        keyring,
      )
    : await rotateWhatsAppEndpointSecret(
        db,
        {
          tenantId: tenant.id,
          actorId: owner.id,
          endpointId: endpoint.endpointId,
          rotationKey: `vault-rls-rotation-${suffix}`,
          secret: {
            accountSid: `AC${suffix.repeat(32)}`,
            authToken: `test-auth-token-${suffix}`,
            senderAddress: `whatsapp:+59669600000${suffix === "a" ? "1" : "2"}`,
          },
          occurredAt: timestamp,
        },
        keyring,
      );
  return {
    ownerId: owner.id,
    tenantId: tenant.id,
    endpointId: endpoint.endpointId,
    identityId,
    secretVersionId: rotated.secretVersionId,
  };
}

async function createRestrictedRole(ownerPool: Pool) {
  if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
  const roleName = `tradikom_vault_rls_${randomUUID().replaceAll("-", "")}`;
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
