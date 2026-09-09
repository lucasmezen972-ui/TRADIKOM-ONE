import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { pgPoolAsSqlClient } from "../src/db/client";
import { migrate } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { hashToken, id } from "../src/lib/security";
import {
  issueWhatsAppMetaTrialAuthorization,
  issueWhatsAppTwilioActivationAuthorization,
  registerAuthorizedMetaWhatsAppEndpoint,
  registerAuthorizedWhatsAppEndpoint,
  reserveWhatsAppMetaTrialBudget,
  reserveWhatsAppOutboundDelivery,
  reserveWhatsAppTwilioActivationBudget,
} from "../src/modules/channels";

const databaseUrl = process.env.DATABASE_URL;
const describeIfPostgres = databaseUrl ? describe : describe.skip;
const ownerPools: Pool[] = [];
const restrictedPools: Pool[] = [];
const restrictedRoles: Array<{ ownerPool: Pool; roleName: string }> = [];
const timestamp = "2026-08-08T18:00:00.000Z";
const expiresAt = "2026-08-08T19:00:00.000Z";

afterEach(async () => {
  await Promise.all(restrictedPools.splice(0).map((pool) => pool.end()));
  for (const role of restrictedRoles.splice(0)) {
    await dropRestrictedRole(role.ownerPool, role.roleName);
  }
  await Promise.all(ownerPools.splice(0).map((pool) => pool.end()));
});

describeIfPostgres(
  "RLS PostgreSQL et concurrence du budget d'activation OS-5",
  () => {
    it("isole les tenants et ne dépasse jamais le plafond sous concurrence", async () => {
      if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
      const ownerPool = new Pool({ connectionString: databaseUrl });
      ownerPools.push(ownerPool);
      const ownerDb = pgPoolAsSqlClient(ownerPool);
      await migrate(ownerDb, { enableRls: true });
      const policies = await ownerPool.query<{
        policyname: string;
        qual: string | null;
        with_check: string | null;
      }>(
        `select policyname, qual, with_check
         from pg_policies
         where schemaname = 'public'
           and tablename = 'channel_provider_activation_consumptions'`,
      );
      expect(policies.rows).toEqual([
        expect.objectContaining({
          policyname: "tenant_isolation",
          qual: expect.stringMatching(/app_is_system.*app_current_tenant_id/i),
          with_check: expect.stringMatching(
            /app_is_system.*app_current_tenant_id/i,
          ),
        }),
      ]);
      const fixtureA = await seedBudgetTenant(ownerDb, "a");
      const fixtureB = await seedBudgetTenant(ownerDb, "b");

      const attempts = await Promise.allSettled(
        fixtureA.deliveryIds.map((deliveryId) =>
          reserveWhatsAppTwilioActivationBudget(
            ownerDb,
            fixtureA.ownerId,
            {
              tenantId: fixtureA.tenantId,
              endpointId: fixtureA.endpointId,
              authorizationId: fixtureA.authorizationId,
              deliveryId,
              occurredAt: timestamp,
            },
          ),
        ),
      );
      expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
      expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
      expect(
        attempts.find((attempt) => attempt.status === "rejected"),
      ).toMatchObject({
        reason: { code: "channel_provider_activation_budget_exhausted" },
      });
      await reserveWhatsAppTwilioActivationBudget(ownerDb, fixtureB.ownerId, {
        tenantId: fixtureB.tenantId,
        endpointId: fixtureB.endpointId,
        authorizationId: fixtureB.authorizationId,
        deliveryId: fixtureB.deliveryIds[0]!,
        occurredAt: timestamp,
      });

      const restricted = await createRestrictedRole(ownerPool);
      restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
      const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
      restrictedPools.push(restrictedPool);

      expect(
        (
          await restrictedPool.query(
            "select id from channel_provider_activation_consumptions",
          )
        ).rows,
      ).toEqual([]);
      const visibleA = await withTenantContext(
        restrictedPool,
        fixtureA.tenantId,
        (client) =>
          client.query<{ tenant_id: string }>(
            "select tenant_id from channel_provider_activation_consumptions",
          ),
      );
      expect(visibleA.rows).toEqual([{ tenant_id: fixtureA.tenantId }]);

      await expect(
        withTenantContext(restrictedPool, fixtureA.tenantId, (client) =>
          client.query(
            `insert into channel_provider_activation_consumptions (
               id, tenant_id, provider, endpoint_id, authorization_id,
               delivery_id, consumed_by, consumed_at
             ) values ($1, $2, 'whatsapp_twilio', $3, $4, $5, $6, $7)`,
            [
              `consumption_cross_${randomUUID()}`,
              fixtureB.tenantId,
              fixtureB.endpointId,
              fixtureB.authorizationId,
              fixtureB.deliveryIds[1],
              fixtureB.ownerId,
              timestamp,
            ],
          ),
        ),
      ).rejects.toThrow(/row-level security|budget_invalid|violates/i);

      const crossUpdate = await withTenantContext(
        restrictedPool,
        fixtureA.tenantId,
        (client) =>
          client.query<{ id: string }>(
            `update channel_provider_activation_consumptions
             set consumed_at = $1 where tenant_id = $2 returning id`,
            [timestamp, fixtureB.tenantId],
          ),
      );
      expect(crossUpdate.rows).toEqual([]);
      const crossDelete = await withTenantContext(
        restrictedPool,
        fixtureA.tenantId,
        (client) =>
          client.query<{ id: string }>(
            `delete from channel_provider_activation_consumptions
             where tenant_id = $1 returning id`,
            [fixtureB.tenantId],
          ),
      );
      expect(crossDelete.rows).toEqual([]);
    });

    it("ne dépasse jamais le plafond Meta d’un message sous concurrence", async () => {
      if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
      const ownerPool = new Pool({ connectionString: databaseUrl });
      ownerPools.push(ownerPool);
      const ownerDb = pgPoolAsSqlClient(ownerPool);
      await migrate(ownerDb, { enableRls: true });
      const fixture = await seedBudgetTenant(ownerDb, "a", "meta");

      const attempts = await Promise.allSettled(
        fixture.deliveryIds.map((deliveryId) =>
          reserveWhatsAppMetaTrialBudget(ownerDb, fixture.ownerId, {
            tenantId: fixture.tenantId,
            endpointId: fixture.endpointId,
            authorizationId: fixture.authorizationId,
            deliveryId,
            occurredAt: timestamp,
          }),
        ),
      );
      expect(
        attempts.filter((attempt) => attempt.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        attempts.filter((attempt) => attempt.status === "rejected"),
      ).toHaveLength(1);
      expect(
        attempts.find((attempt) => attempt.status === "rejected"),
      ).toMatchObject({
        reason: { code: "channel_provider_activation_budget_exhausted" },
      });
      const count = await ownerDb.query<{ count: number }>(
        `select count(*)::integer as count
         from channel_provider_activation_consumptions
         where tenant_id = $1 and provider = 'whatsapp_meta'`,
        [fixture.tenantId],
      );
      expect(count.rows[0]?.count).toBe(1);

      const sameDeliveryFixture = await seedBudgetTenant(ownerDb, "b", "meta");
      const restricted = await createRestrictedRole(ownerPool);
      restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
      const restrictedPool = new Pool({
        connectionString: restricted.databaseUrl,
      });
      restrictedPools.push(restrictedPool);
      const restrictedDb = pgPoolAsSqlClient(restrictedPool);
      const sameDeliveryAttempts = await Promise.allSettled(
        [1, 2].map(() =>
          reserveWhatsAppMetaTrialBudget(
            restrictedDb,
            sameDeliveryFixture.ownerId,
            {
              tenantId: sameDeliveryFixture.tenantId,
              endpointId: sameDeliveryFixture.endpointId,
              authorizationId: sameDeliveryFixture.authorizationId,
              deliveryId: sameDeliveryFixture.deliveryIds[0]!,
              occurredAt: timestamp,
            },
          ),
        ),
      );
      expect(
        sameDeliveryAttempts.filter(
          (attempt) => attempt.status === "fulfilled",
        ),
      ).toHaveLength(2);
      const sameDeliveryResults = sameDeliveryAttempts
        .filter(
          (
            attempt,
          ): attempt is PromiseFulfilledResult<
            Awaited<ReturnType<typeof reserveWhatsAppMetaTrialBudget>>
          > => attempt.status === "fulfilled",
        )
        .map((attempt) => attempt.value.replayed)
        .sort();
      expect(sameDeliveryResults).toEqual([false, true]);
      const sameDeliveryCount = await ownerDb.query<{ count: number }>(
        `select count(*)::integer as count
         from channel_provider_activation_consumptions
         where tenant_id = $1 and provider = 'whatsapp_meta'`,
        [sameDeliveryFixture.tenantId],
      );
      expect(sameDeliveryCount.rows[0]?.count).toBe(1);
      const visibleSameTenant = await withTenantContext(
        restrictedPool,
        sameDeliveryFixture.tenantId,
        (client) =>
          client.query<{ tenant_id: string }>(
            `select tenant_id from channel_provider_activation_consumptions
             where provider = 'whatsapp_meta'`,
          ),
      );
      expect(visibleSameTenant.rows).toEqual([
        { tenant_id: sameDeliveryFixture.tenantId },
      ]);
      const hiddenOtherTenant = await withTenantContext(
        restrictedPool,
        fixture.tenantId,
        (client) =>
          client.query<{ tenant_id: string }>(
            `select tenant_id from channel_provider_activation_consumptions
             where tenant_id = $1 and provider = 'whatsapp_meta'`,
            [sameDeliveryFixture.tenantId],
          ),
      );
      expect(hiddenOtherTenant.rows).toEqual([]);
    });
  },
);

type OwnerDb = ReturnType<typeof pgPoolAsSqlClient>;

async function seedBudgetTenant(
  db: OwnerDb,
  label: "a" | "b",
  provider: "twilio" | "meta" = "twilio",
) {
  const unique = randomUUID().replaceAll("-", "");
  const services = createServices(db);
  const owner = await services.registerUser({
    name: `Budget RLS ${label}`,
    email: `budget-rls-${label}-${unique}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Budget RLS ${label} ${unique}`,
    category: "Services",
  });
  const endpoint =
    provider === "meta"
      ? await registerAuthorizedMetaWhatsAppEndpoint(
          db,
          {
            tenantId: tenant.id,
            actorId: owner.id,
            externalAccountId: `3${unique.replace(/[^0-9]/g, "").padEnd(18, "1").slice(0, 18)}`,
            phoneNumberId: `8${unique.replace(/[^0-9]/g, "").padEnd(15, "2").slice(0, 15)}`,
            occurredAt: timestamp,
          },
          `budget-rls-fingerprint-${unique}`,
        )
      : await registerAuthorizedWhatsAppEndpoint(
          db,
          {
            tenantId: tenant.id,
            actorId: owner.id,
            externalAccountId: `AC${unique.slice(0, 32)}`,
            destinationAddress:
              label === "a"
                ? "whatsapp:+15005550121"
                : "whatsapp:+15005550122",
            occurredAt: timestamp,
          },
          `budget-rls-fingerprint-${unique}`,
        );
  const authorization =
    provider === "meta"
      ? await issueWhatsAppMetaTrialAuthorization(db, {
          tenantId: tenant.id,
          actorId: owner.id,
          endpointId: endpoint.endpointId,
          idempotencyKey: `budget-meta-rls-authorization-${unique}`,
          freeUnitsConfirmed: true,
          expiresAt,
          occurredAt: timestamp,
        })
      : await issueWhatsAppTwilioActivationAuthorization(db, {
          tenantId: tenant.id,
          actorId: owner.id,
          endpointId: endpoint.endpointId,
          idempotencyKey: `budget-rls-authorization-${unique}`,
          maxMessages: 1,
          freeUnitsConfirmed: true,
          expiresAt,
          occurredAt: timestamp,
        });
  const threadId = `thread_budget_rls_${unique}`;
  const customerParticipantId = `participant_budget_customer_${unique}`;
  const systemParticipantId = `participant_budget_system_${unique}`;
  const customerIdentityId = `identity_budget_customer_${unique}`;
  const systemIdentityId = `identity_budget_system_${unique}`;
  const messageId = `message_budget_${unique}`;
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values
       ($1, $2, 'customer', null, $3, $3),
       ($4, $2, 'system', null, $3, $3)`,
    [customerParticipantId, tenant.id, timestamp, systemParticipantId],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values
       ($1, $2, $3, 'messaging', $9, $4, null,
        'customer', 'active', $5, $5),
       ($6, $2, $7, 'web', 'web-chat', $8, null,
        'system', 'active', $5, $5)`,
    [
      customerIdentityId,
      tenant.id,
      customerParticipantId,
      `budget_customer_${unique}`,
      timestamp,
      systemIdentityId,
      systemParticipantId,
      `budget_system_${unique}`,
      provider === "meta" ? "whatsapp-meta" : "whatsapp-twilio",
    ],
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
     ) values ($1, $2, $3, $4), ($1, $2, $5, $4)`,
    [tenant.id, threadId, customerIdentityId, timestamp, systemIdentityId],
  );
  await db.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, causation_id, safe_error_code, occurred_at, created_at
     ) values (
       $1, $2, $3, $4, 'outbound', 'result', 'pending', 'Preuve RLS',
       'web-chat', null, $5, $6, null, null, $7, $7
     )`,
    [
      messageId,
      tenant.id,
      threadId,
      systemIdentityId,
      `canonical:${messageId}`,
      `correlation:${messageId}`,
      timestamp,
    ],
  );
  const deliveryIds: string[] = [];
  for (const index of [1, 2]) {
    const deliveryId = id("channel_delivery");
    await reserveWhatsAppOutboundDelivery(db, {
      id: deliveryId,
      tenantId: tenant.id,
      endpointId: endpoint.endpointId,
      messageId,
      channelIdentityId: customerIdentityId,
      idempotencyKey: `budget-rls-delivery-${unique}-${index}`,
      requestFingerprint: hashToken(`${unique}:${index}`),
      actorId: owner.id,
      occurredAt: timestamp,
      maxAttempts: 3,
      activationAuthorizationId: authorization.authorizationId,
      provider: provider === "meta" ? "whatsapp_meta" : "whatsapp_twilio",
    });
    deliveryIds.push(deliveryId);
  }
  return {
    ownerId: owner.id,
    tenantId: tenant.id,
    endpointId: endpoint.endpointId,
    authorizationId: authorization.authorizationId,
    deliveryIds,
  };
}

async function createRestrictedRole(ownerPool: Pool) {
  if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
  const roleName = `tradikom_budget_rls_${randomUUID().replaceAll("-", "")}`;
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
