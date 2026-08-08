import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { pgPoolAsSqlClient } from "../src/db/client";
import { migrate } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { hashToken, id } from "../src/lib/security";
import {
  registerAuthorizedWhatsAppEndpoint,
  reserveWhatsAppOutboundDelivery,
} from "../src/modules/channels";

const databaseUrl = process.env.DATABASE_URL;
const describeIfPostgres = databaseUrl ? describe : describe.skip;
const ownerPools: Pool[] = [];
const restrictedPools: Pool[] = [];
const restrictedRoles: Array<{ ownerPool: Pool; roleName: string }> = [];
const fingerprintSecret = "postgres-rls-fingerprint-secret-32-bytes";
const timestamp = "2026-08-08T08:00:00.000Z";

afterEach(async () => {
  await Promise.all(restrictedPools.splice(0).map((pool) => pool.end()));
  for (const role of restrictedRoles.splice(0)) {
    await dropRestrictedRole(role.ownerPool, role.roleName);
  }
  await Promise.all(ownerPools.splice(0).map((pool) => pool.end()));
});

describeIfPostgres("RLS PostgreSQL des reprises WhatsApp", () => {
  it("isole lecture, claim, update et delete par tenant", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });
    const services = createServices(ownerDb);
    const fixtureA = await seedTenantDelivery(ownerDb, services, "a");
    const fixtureB = await seedTenantDelivery(ownerDb, services, "b");

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);

    expect(
      (await restrictedPool.query("select id from channel_provider_deliveries"))
        .rows,
    ).toEqual([]);
    const visibleA = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          "select id from channel_provider_deliveries order by id",
        ),
    );
    expect(visibleA.rows).toEqual([{ id: fixtureA.deliveryId }]);

    const crossTenantClaim = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          `update channel_provider_deliveries
           set attempts = attempts + 1, last_attempted_at = $1,
               lease_id = 'cross-tenant-lease', lease_expires_at = $2,
               updated_at = $1
           where tenant_id = $3 and id = $4
           returning id`,
          [
            timestamp,
            "2026-08-08T08:01:00.000Z",
            fixtureB.tenantId,
            fixtureB.deliveryId,
          ],
        ),
    );
    expect(crossTenantClaim.rows).toEqual([]);
    const ownClaim = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string; attempts: number }>(
          `update channel_provider_deliveries
           set attempts = attempts + 1, last_attempted_at = $1,
               lease_id = 'tenant-a-lease', lease_expires_at = $2,
               updated_at = $1
           where tenant_id = $3 and id = $4
           returning id, attempts`,
          [
            timestamp,
            "2026-08-08T08:01:00.000Z",
            fixtureA.tenantId,
            fixtureA.deliveryId,
          ],
        ),
    );
    expect(ownClaim.rows).toEqual([{ id: fixtureA.deliveryId, attempts: 1 }]);
    const crossTenantDelete = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          `delete from channel_provider_deliveries
           where tenant_id = $1 and id = $2 returning id`,
          [fixtureB.tenantId, fixtureB.deliveryId],
        ),
    );
    expect(crossTenantDelete.rows).toEqual([]);
  });
});

type OwnerDb = ReturnType<typeof pgPoolAsSqlClient>;
type Services = ReturnType<typeof createServices>;

async function seedTenantDelivery(
  db: OwnerDb,
  services: Services,
  suffix: "a" | "b",
) {
  const owner = await services.registerUser({
    name: `RLS WhatsApp ${suffix}`,
    email: `rls-whatsapp-${suffix}-${randomUUID()}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `RLS WhatsApp ${suffix} ${randomUUID()}`,
    category: "Services",
  });
  const endpoint = await registerAuthorizedWhatsAppEndpoint(
    db,
    {
      tenantId: tenant.id,
      actorId: owner.id,
      externalAccountId: `AC${suffix.repeat(32)}`,
      destinationAddress: `whatsapp:+59669600000${suffix === "a" ? "1" : "2"}`,
    },
    fingerprintSecret,
  );
  const participantId = id("participant");
  const identityId = id("identity");
  const threadId = id("thread");
  const messageId = id("message");
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
     ) values ($1, $2, $3, 'messaging', 'whatsapp-twilio', $4, null,
       'customer', 'active', $5, $5)`,
    [identityId, tenant.id, participantId, `subject_${suffix}`, timestamp],
  );
  await db.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, created_at, updated_at, last_message_at
     ) values ($1, $2, 'open', null, $3, $3, $3)`,
    [threadId, tenant.id, timestamp],
  );
  await db.query(
    `insert into conversation_thread_participants (
       tenant_id, thread_id, channel_identity_id, joined_at
     ) values ($1, $2, $3, $4)`,
    [tenant.id, threadId, identityId, timestamp],
  );
  await db.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, causation_id, safe_error_code, occurred_at, created_at
     ) values ($1, $2, $3, $4, 'outbound', 'result', 'pending', 'Test RLS',
       'whatsapp-twilio', null, $5, $6, null, null, $7, $7)`,
    [
      messageId,
      tenant.id,
      threadId,
      identityId,
      `message-rls-${suffix}`,
      `correlation-rls-${suffix}`,
      timestamp,
    ],
  );
  const deliveryId = id("channel_delivery");
  await reserveWhatsAppOutboundDelivery(db, {
    id: deliveryId,
    tenantId: tenant.id,
    endpointId: endpoint.endpointId,
    messageId,
    channelIdentityId: identityId,
    idempotencyKey: `delivery-rls-${suffix}`,
    requestFingerprint: hashToken(
      JSON.stringify([
        "whatsapp_twilio",
        endpoint.endpointId,
        messageId,
        identityId,
      ]),
    ),
    actorId: owner.id,
    occurredAt: timestamp,
    maxAttempts: 3,
  });
  return { tenantId: tenant.id, deliveryId };
}

async function createRestrictedRole(ownerPool: Pool) {
  if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
  const roleName = `tradikom_channel_rls_${randomUUID().replaceAll("-", "")}`;
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
