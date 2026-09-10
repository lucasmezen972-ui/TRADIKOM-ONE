import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { hashToken, id } from "../src/lib/security";
import {
  ChannelProviderEndpointError,
  createChannelProviderSecretKeyring,
  inspectMetaWhatsAppTenantReadiness,
  issueWhatsAppMetaTrialAuthorization,
  registerAuthorizedMetaWhatsAppEndpoint,
  reserveWhatsAppMetaTrialBudget,
  reserveWhatsAppOutboundDelivery,
  revokeWhatsAppMetaTrialAuthorization,
  revokeMetaWhatsAppEndpointSecret,
  rotateMetaWhatsAppEndpointSecret,
  setAuthorizedMetaWhatsAppEndpointStatus,
} from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const fingerprintSecret = "meta-readiness-fingerprint-secret-32-bytes";
const timestamp = "2026-09-05T04:30:00.000Z";
const later = "2026-09-05T04:31:00.000Z";
const expiresAt = "2026-09-05T05:30:00.000Z";
const wabaId = "315589313241560883";
const phoneNumberId = "8794189252778687";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("préparation tenant WhatsApp Meta", () => {
  it("distingue canal absent, suspendu, accès manquant et organisation prête", async () => {
    const setup = await createSetup();

    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantA.id,
      ),
    ).resolves.toEqual({
      provider: "whatsapp_meta",
      state: "not_registered",
      checks: {
        endpoint: "missing",
        credentials: "not_checked",
        trialAuthorization: "not_checked",
      },
    });

    const endpoint = await registerAuthorizedMetaWhatsAppEndpoint(
      setup.db,
      {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        externalAccountId: wabaId,
        phoneNumberId,
        occurredAt: timestamp,
      },
      fingerprintSecret,
    );
    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantA.id,
      ),
    ).resolves.toMatchObject({
      state: "credentials_missing",
      checks: {
        endpoint: "active",
        credentials: "missing",
        trialAuthorization: "not_checked",
      },
    });

    await setAuthorizedMetaWhatsAppEndpointStatus(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: endpoint.endpointId,
      status: "disabled",
      occurredAt: timestamp,
    });
    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantA.id,
      ),
    ).resolves.toMatchObject({
      state: "disabled",
      checks: {
        endpoint: "disabled",
        credentials: "not_checked",
        trialAuthorization: "not_checked",
      },
    });

    await setAuthorizedMetaWhatsAppEndpointStatus(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: endpoint.endpointId,
      status: "active",
      occurredAt: later,
    });
    await rotateMetaWhatsAppEndpointSecret(
      setup.db,
      {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: endpoint.endpointId,
        rotationKey: "meta-readiness-endpoint-v1",
        secret: {
          wabaId,
          accessToken: "meta-readiness-test-token-never-real",
          phoneNumberId,
          graphApiVersion: "v23.0",
          appSecret: "meta-readiness-app-secret-never-real",
          webhookVerifyToken: "meta-readiness-webhook-token-never-real",
        },
        occurredAt: later,
      },
      createChannelProviderSecretKeyring({
        activeKeyVersion: "test-v1",
        keys: { "test-v1": Buffer.alloc(32, 41) },
      }),
      fingerprintSecret,
    );
    const ready = await inspectMetaWhatsAppTenantReadiness(
      setup.db,
      setup.ownerA.id,
      setup.tenantA.id,
    );
    expect(ready).toEqual({
      provider: "whatsapp_meta",
      state: "ready",
      checks: {
        endpoint: "active",
        credentials: "active",
        trialAuthorization: "required",
      },
    });
    expect(JSON.stringify(ready)).not.toMatch(
      /token|secret|waba|phone|endpointId|externalAccountId/i,
    );

    const endpointB = await registerAuthorizedMetaWhatsAppEndpoint(
      setup.db,
      {
        tenantId: setup.tenantB.id,
        actorId: setup.ownerB.id,
        externalAccountId: "425589313241560884",
        phoneNumberId: "9794189252778688",
        occurredAt: timestamp,
      },
      fingerprintSecret,
    );
    await rotateMetaWhatsAppEndpointSecret(
      setup.db,
      {
        tenantId: setup.tenantB.id,
        actorId: setup.ownerB.id,
        endpointId: endpointB.endpointId,
        rotationKey: "meta-readiness-endpoint-b-v1",
        secret: {
          wabaId: "425589313241560884",
          accessToken: "meta-readiness-b-test-token-never-real",
          phoneNumberId: "9794189252778688",
          graphApiVersion: "v23.0",
          appSecret: "meta-readiness-b-app-secret-never-real",
          webhookVerifyToken: "meta-readiness-b-webhook-token-never-real",
        },
        occurredAt: later,
      },
      createChannelProviderSecretKeyring({
        activeKeyVersion: "test-v1",
        keys: { "test-v1": Buffer.alloc(32, 41) },
      }),
      fingerprintSecret,
    );
    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerB.id,
        setup.tenantB.id,
        new Date("2026-09-05T04:32:00.000Z"),
      ),
    ).resolves.toMatchObject({
      state: "ready",
      checks: { trialAuthorization: "required" },
    });

    const authorization = await issueWhatsAppMetaTrialAuthorization(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: endpoint.endpointId,
      idempotencyKey: "meta-readiness-trial-authorization",
      freeUnitsConfirmed: true,
      expiresAt,
      occurredAt: later,
    });
    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantA.id,
        new Date("2026-09-05T04:32:00.000Z"),
      ),
    ).resolves.toMatchObject({
      state: "ready",
      checks: { trialAuthorization: "valid" },
    });
    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerB.id,
        setup.tenantB.id,
        new Date("2026-09-05T04:32:00.000Z"),
      ),
    ).resolves.toMatchObject({
      state: "ready",
      checks: { trialAuthorization: "required" },
    });

    await issueWhatsAppMetaTrialAuthorization(setup.db, {
      tenantId: setup.tenantB.id,
      actorId: setup.ownerB.id,
      endpointId: endpointB.endpointId,
      idempotencyKey: "meta-readiness-expired-b-authorization",
      freeUnitsConfirmed: true,
      expiresAt: "2026-09-05T04:33:00.000Z",
      occurredAt: later,
    });
    const revokedAuthorizationB = await issueWhatsAppMetaTrialAuthorization(
      setup.db,
      {
        tenantId: setup.tenantB.id,
        actorId: setup.ownerB.id,
        endpointId: endpointB.endpointId,
        idempotencyKey: "meta-readiness-revoked-b-authorization",
        freeUnitsConfirmed: true,
        expiresAt,
        occurredAt: later,
      },
    );
    await revokeWhatsAppMetaTrialAuthorization(setup.db, {
      tenantId: setup.tenantB.id,
      actorId: setup.ownerB.id,
      authorizationId: revokedAuthorizationB.authorizationId,
      occurredAt: "2026-09-05T04:32:00.000Z",
    });
    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerB.id,
        setup.tenantB.id,
        new Date("2026-09-05T04:34:00.000Z"),
      ),
    ).resolves.toMatchObject({
      state: "ready",
      checks: { trialAuthorization: "required" },
    });

    const deliveryId = await seedTrialDelivery(
      setup,
      endpoint.endpointId,
      authorization.authorizationId,
    );
    await reserveWhatsAppMetaTrialBudget(setup.db, setup.ownerA.id, {
      tenantId: setup.tenantA.id,
      endpointId: endpoint.endpointId,
      authorizationId: authorization.authorizationId,
      deliveryId,
      occurredAt: "2026-09-05T04:33:00.000Z",
    });
    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantA.id,
        new Date("2026-09-05T04:34:00.000Z"),
      ),
    ).resolves.toMatchObject({
      state: "ready",
      checks: { trialAuthorization: "exhausted" },
    });

    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerB.id,
        setup.tenantB.id,
        new Date("2026-09-05T04:34:00.000Z"),
      ),
    ).resolves.toMatchObject({
      state: "ready",
      checks: { trialAuthorization: "required" },
    });

    await issueWhatsAppMetaTrialAuthorization(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: endpoint.endpointId,
      idempotencyKey: "meta-readiness-second-valid-authorization",
      freeUnitsConfirmed: true,
      expiresAt,
      occurredAt: "2026-09-05T04:34:30.000Z",
    });
    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantA.id,
        new Date("2026-09-05T04:35:00.000Z"),
      ),
    ).resolves.toMatchObject({
      state: "ready",
      checks: { trialAuthorization: "valid" },
    });

    await revokeMetaWhatsAppEndpointSecret(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: endpoint.endpointId,
      occurredAt: later,
    });
    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantA.id,
      ),
    ).resolves.toMatchObject({ state: "credentials_missing" });
  });

  it("conserve l’état épuisé après l’expiration d’une autorisation consommée", async () => {
    const setup = await createSetup();
    const endpoint = await registerAuthorizedMetaWhatsAppEndpoint(
      setup.db,
      {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        externalAccountId: wabaId,
        phoneNumberId,
        occurredAt: timestamp,
      },
      fingerprintSecret,
    );
    await rotateMetaWhatsAppEndpointSecret(
      setup.db,
      {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: endpoint.endpointId,
        rotationKey: "meta-readiness-expired-consumption-v1",
        secret: {
          wabaId,
          accessToken: "meta-readiness-expired-consumption-token-never-real",
          phoneNumberId,
          graphApiVersion: "v23.0",
          appSecret: "meta-readiness-expired-consumption-secret-never-real",
          webhookVerifyToken:
            "meta-readiness-expired-consumption-webhook-never-real",
        },
        occurredAt: later,
      },
      createChannelProviderSecretKeyring({
        activeKeyVersion: "test-v1",
        keys: { "test-v1": Buffer.alloc(32, 41) },
      }),
      fingerprintSecret,
    );
    const authorization = await issueWhatsAppMetaTrialAuthorization(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: endpoint.endpointId,
      idempotencyKey: "meta-readiness-expired-consumption",
      freeUnitsConfirmed: true,
      expiresAt: "2026-09-05T04:33:00.000Z",
      occurredAt: later,
    });
    const deliveryId = await seedTrialDelivery(
      setup,
      endpoint.endpointId,
      authorization.authorizationId,
    );
    await reserveWhatsAppMetaTrialBudget(setup.db, setup.ownerA.id, {
      tenantId: setup.tenantA.id,
      endpointId: endpoint.endpointId,
      authorizationId: authorization.authorizationId,
      deliveryId,
      occurredAt: "2026-09-05T04:32:00.000Z",
    });

    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantA.id,
        new Date("2026-09-05T04:34:00.000Z"),
      ),
    ).resolves.toMatchObject({
      state: "ready",
      checks: { trialAuthorization: "exhausted" },
    });
  });

  it("signale plusieurs endpoints Meta configurés comme ambigus", async () => {
    const setup = await createSetup();
    const keyring = createChannelProviderSecretKeyring({
      activeKeyVersion: "test-v1",
      keys: { "test-v1": Buffer.alloc(32, 41) },
    });
    const endpoints = [
      {
        externalAccountId: wabaId,
        phoneNumberId,
        rotationKey: "meta-readiness-ambiguous-endpoint-a-v1",
        suffix: "a",
      },
      {
        externalAccountId: "515589313241560885",
        phoneNumberId: "6794189252778689",
        rotationKey: "meta-readiness-ambiguous-endpoint-b-v1",
        suffix: "b",
      },
    ];

    for (const candidate of endpoints) {
      const endpoint = await registerAuthorizedMetaWhatsAppEndpoint(
        setup.db,
        {
          tenantId: setup.tenantA.id,
          actorId: setup.ownerA.id,
          externalAccountId: candidate.externalAccountId,
          phoneNumberId: candidate.phoneNumberId,
          occurredAt: timestamp,
        },
        fingerprintSecret,
      );
      await rotateMetaWhatsAppEndpointSecret(
        setup.db,
        {
          tenantId: setup.tenantA.id,
          actorId: setup.ownerA.id,
          endpointId: endpoint.endpointId,
          rotationKey: candidate.rotationKey,
          secret: {
            wabaId: candidate.externalAccountId,
            accessToken: `meta-readiness-ambiguous-${candidate.suffix}-token-never-real`,
            phoneNumberId: candidate.phoneNumberId,
            graphApiVersion: "v23.0",
            appSecret: `meta-readiness-ambiguous-${candidate.suffix}-app-secret-never-real`,
            webhookVerifyToken: `meta-readiness-ambiguous-${candidate.suffix}-webhook-token-never-real`,
          },
          occurredAt: later,
        },
        keyring,
        fingerprintSecret,
      );
    }

    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantA.id,
        new Date("2026-09-05T04:32:00.000Z"),
      ),
    ).resolves.toEqual({
      provider: "whatsapp_meta",
      state: "ambiguous",
      checks: {
        endpoint: "active",
        credentials: "active",
        trialAuthorization: "required",
      },
    });
  });

  it("refuse un acteur qui n’est pas membre de l’organisation", async () => {
    const setup = await createSetup();

    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantB.id,
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_endpoint_access_denied",
    } satisfies Partial<ChannelProviderEndpointError>);
  });
});

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const ownerA = await services.registerUser({
    name: "Responsable préparation Meta A",
    email: `meta-readiness-a-${opened.length}@example.test`,
    password: "Password!1",
  });
  const ownerB = await services.registerUser({
    name: "Responsable préparation Meta B",
    email: `meta-readiness-b-${opened.length}@example.test`,
    password: "Password!1",
  });
  const tenantA = await services.createTenant(ownerA.id, {
    name: "Organisation préparation Meta A",
    category: "Services",
  });
  const tenantB = await services.createTenant(ownerB.id, {
    name: "Organisation préparation Meta B",
    category: "Services",
  });
  return { db, ownerA, ownerB, tenantA, tenantB };
}

async function seedTrialDelivery(
  setup: Awaited<ReturnType<typeof createSetup>>,
  endpointId: string,
  authorizationId: string,
) {
  const suffix = opened.length;
  const threadId = `thread_meta_readiness_${suffix}`;
  const customerParticipantId = `participant_meta_readiness_customer_${suffix}`;
  const systemParticipantId = `participant_meta_readiness_system_${suffix}`;
  const customerIdentityId = `identity_meta_readiness_customer_${suffix}`;
  const systemIdentityId = `identity_meta_readiness_system_${suffix}`;
  const messageId = `message_meta_readiness_${suffix}`;
  await setup.db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values
       ($1, $2, 'customer', null, $3, $3),
       ($4, $2, 'system', null, $3, $3)`,
    [customerParticipantId, setup.tenantA.id, later, systemParticipantId],
  );
  await setup.db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values
       ($1, $2, $3, 'messaging', 'whatsapp-meta', $4, null,
        'customer', 'active', $5, $5),
       ($6, $2, $7, 'web', 'web-chat', $8, null,
        'system', 'active', $5, $5)`,
    [
      customerIdentityId,
      setup.tenantA.id,
      customerParticipantId,
      `meta_readiness_customer_${suffix}`,
      later,
      systemIdentityId,
      systemParticipantId,
      `meta_readiness_system_${suffix}`,
    ],
  );
  await setup.db.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, created_at, updated_at, last_message_at
     ) values ($1, $2, 'open', null, $3, $3, $3)`,
    [threadId, setup.tenantA.id, later],
  );
  await setup.db.query(
    `insert into conversation_thread_participants (
       tenant_id, thread_id, channel_identity_id, joined_at
     ) values ($1, $2, $3, $4), ($1, $2, $5, $4)`,
    [
      setup.tenantA.id,
      threadId,
      customerIdentityId,
      later,
      systemIdentityId,
    ],
  );
  await setup.db.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, causation_id, safe_error_code, occurred_at, created_at
     ) values (
       $1, $2, $3, $4, 'outbound', 'result', 'pending', 'Preuve de préparation',
       'web-chat', null, $5, $6, null, null, $7, $7
     )`,
    [
      messageId,
      setup.tenantA.id,
      threadId,
      systemIdentityId,
      `canonical:${messageId}`,
      `correlation:${messageId}`,
      later,
    ],
  );
  const deliveryId = id("channel_delivery");
  await reserveWhatsAppOutboundDelivery(setup.db, {
    id: deliveryId,
    tenantId: setup.tenantA.id,
    endpointId,
    messageId,
    channelIdentityId: customerIdentityId,
    idempotencyKey: "meta-readiness-trial-delivery",
    requestFingerprint: hashToken("meta-readiness-trial-delivery"),
    actorId: setup.ownerA.id,
    occurredAt: later,
    maxAttempts: 1,
    activationAuthorizationId: authorizationId,
    provider: "whatsapp_meta",
  });
  return deliveryId;
}
