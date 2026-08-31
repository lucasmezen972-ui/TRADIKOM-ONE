import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { id } from "../src/lib/security";
import {
  ChannelProviderSecretError,
  createChannelProviderSecretKeyring,
  createWhatsAppMetaSecretResolvers,
  createWhatsAppMetaTransport,
  registerAuthorizedMetaWhatsAppEndpoint,
  reserveMetaWhatsAppIdentityBinding,
  revokeMetaWhatsAppEndpointSecret,
  revokeMetaWhatsAppIdentitySecret,
  rotateMetaWhatsAppEndpointSecret,
  rotateMetaWhatsAppIdentitySecret,
} from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const fingerprintSecret = "meta-vault-fingerprint-secret-at-least-32-bytes";
const timestamp = "2026-08-31T12:00:00.000Z";
const later = "2026-08-31T12:01:00.000Z";
const wabaId = "123456789012345";
const phoneNumberId = "234567890123456";
const accessToken = "meta-test-access-token-never-real-1234567890";
const appSecret = "meta-test-app-secret-never-real";
const webhookVerifyToken = "meta-test-webhook-verify-token";
const recipientPhoneNumber = "+596696000000";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("coffre fournisseur WhatsApp Meta tenant-aware", () => {
  it("résout les secrets éphémèrement et les branche au transport sans fuite persistée", async () => {
    const setup = await createSetup();
    const keyring = keyringV1();
    await rotateEndpoint(setup, keyring, "meta-endpoint-rotation-1");
    await rotateIdentity(setup, keyring, "meta-identity-rotation-1");
    const resolvers = createWhatsAppMetaSecretResolvers(setup.db, keyring);

    await expect(
      resolvers.resolveCredentials({
        tenantId: setup.tenantA.id,
        endpointId: setup.endpointA.endpointId,
      }),
    ).resolves.toEqual({ accessToken, phoneNumberId, graphApiVersion: "v23.0" });
    await expect(
      resolvers.resolveDestination({
        tenantId: setup.tenantA.id,
        endpointId: setup.endpointA.endpointId,
        channelIdentityId: setup.identityA,
      }),
    ).resolves.toEqual({ recipientPhoneNumber });
    await expect(
      resolvers.resolveWebhookSecrets({
        tenantId: setup.tenantA.id,
        endpointId: setup.endpointA.endpointId,
      }),
    ).resolves.toEqual({ appSecret, verifyToken: webhookVerifyToken });

    const fetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ messages: [{ id: "wamid.test" }] }),
    });
    const transport = createWhatsAppMetaTransport({
      state: "mock",
      ...resolvers,
      fetch,
    });
    await expect(
      transport.sendMessage({
        tenantId: setup.tenantA.id,
        endpointId: setup.endpointA.endpointId,
        channelIdentityId: setup.identityA,
        messageId: "message-meta-vault-integration",
        idempotencyKey: "meta-vault-integration-send",
        text: "Résultat métier de test.",
      }),
    ).resolves.toMatchObject({ status: "accepted", provider: "whatsapp_meta" });
    expect(fetch).toHaveBeenCalledOnce();

    const stored = await setup.db.query<{
      encrypted_payload: string;
      rotation_key_hash: string;
    }>(
      `select encrypted_payload, rotation_key_hash
       from channel_provider_secret_versions where tenant_id = $1`,
      [setup.tenantA.id],
    );
    const serialized = JSON.stringify(stored.rows);
    expect(stored.rows).toHaveLength(2);
    expect(serialized).not.toContain(accessToken);
    expect(serialized).not.toContain(appSecret);
    expect(serialized).not.toContain(webhookVerifyToken);
    expect(serialized).not.toContain(recipientPhoneNumber);

    const audits = await setup.db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action = 'channel.provider_secret_rotated'`,
      [setup.tenantA.id],
    );
    expect(audits.rows).toHaveLength(2);
    expect(JSON.stringify(audits.rows)).not.toContain(accessToken);
    expect(JSON.stringify(audits.rows)).not.toContain(recipientPhoneNumber);
  });

  it("rend la rotation idempotente, versionnée et la révocation monotone", async () => {
    const setup = await createSetup();
    const v1 = keyringV1();
    const first = await rotateEndpoint(setup, v1, "meta-endpoint-rotation-1");
    const replay = await rotateEndpoint(setup, v1, "meta-endpoint-rotation-1");
    expect(replay).toEqual({ ...first, replayed: true });

    await expect(
      rotateMetaWhatsAppEndpointSecret(
        setup.db,
        endpointRotationInput(setup, "meta-endpoint-rotation-1", {
          accessToken: `${accessToken}-conflict`,
        }),
        v1,
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_secret_idempotency_conflict",
    } satisfies Partial<ChannelProviderSecretError>);

    const v2 = createChannelProviderSecretKeyring({
      activeKeyVersion: "test-v2",
      keys: {
        "test-v1": Buffer.alloc(32, 11),
        "test-v2": Buffer.alloc(32, 22),
      },
    });
    const second = await rotateMetaWhatsAppEndpointSecret(
      setup.db,
      endpointRotationInput(setup, "meta-endpoint-rotation-2", {
        accessToken: `${accessToken}-rotated`,
        occurredAt: later,
      }),
      v2,
    );
    expect(second).toMatchObject({ secretVersion: 2, keyVersion: "test-v2" });
    await expect(
      revokeMetaWhatsAppEndpointSecret(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: setup.endpointA.endpointId,
        occurredAt: later,
      }),
    ).resolves.toEqual({ revoked: true, replayed: false });
    await expect(
      revokeMetaWhatsAppEndpointSecret(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: setup.endpointA.endpointId,
        occurredAt: later,
      }),
    ).resolves.toEqual({ revoked: false, replayed: true });
  });

  it("refuse les références inter-tenant, le mauvais WABA et une identité non liée", async () => {
    const setup = await createSetup();
    const keyring = keyringV1();
    await expect(
      rotateMetaWhatsAppEndpointSecret(
        setup.db,
        {
          ...endpointRotationInput(setup, "meta-cross-tenant"),
          endpointId: setup.endpointB.endpointId,
        },
        keyring,
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_secret_reference_invalid",
    } satisfies Partial<ChannelProviderSecretError>);
    await expect(
      rotateMetaWhatsAppEndpointSecret(
        setup.db,
        endpointRotationInput(setup, "meta-waba-mismatch", {
          wabaId: "999999999999999",
        }),
        keyring,
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_secret_reference_invalid",
    } satisfies Partial<ChannelProviderSecretError>);

    const unboundIdentity = await seedMetaIdentity(
      setup.db,
      setup.tenantA.id,
      "unbound",
    );
    await expect(
      rotateMetaWhatsAppIdentitySecret(
        setup.db,
        {
          tenantId: setup.tenantA.id,
          actorId: setup.ownerA.id,
          endpointId: setup.endpointA.endpointId,
          channelIdentityId: unboundIdentity,
          rotationKey: "meta-unbound-identity",
          secret: { recipientPhoneNumber },
          occurredAt: timestamp,
        },
        keyring,
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_secret_reference_invalid",
    } satisfies Partial<ChannelProviderSecretError>);
  });

  it("révoque une destination sans exposer sa valeur", async () => {
    const setup = await createSetup();
    const keyring = keyringV1();
    await rotateEndpoint(setup, keyring, "meta-endpoint-rotation-1");
    await rotateIdentity(setup, keyring, "meta-identity-rotation-1");
    await expect(
      revokeMetaWhatsAppIdentitySecret(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: setup.endpointA.endpointId,
        channelIdentityId: setup.identityA,
        occurredAt: later,
      }),
    ).resolves.toEqual({ revoked: true, replayed: false });
    await expect(
      createWhatsAppMetaSecretResolvers(setup.db, keyring).resolveDestination({
        tenantId: setup.tenantA.id,
        endpointId: setup.endpointA.endpointId,
        channelIdentityId: setup.identityA,
      }),
    ).resolves.toBeNull();
  });
});

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const ownerA = await services.registerUser({
    name: "Propriétaire Meta A",
    email: `meta-vault-owner-a-${opened.length}@example.test`,
    password: "Password!1",
  });
  const ownerB = await services.registerUser({
    name: "Propriétaire Meta B",
    email: `meta-vault-owner-b-${opened.length}@example.test`,
    password: "Password!1",
  });
  const tenantA = await services.createTenant(ownerA.id, {
    name: "Organisation coffre Meta A",
    category: "Services",
  });
  const tenantB = await services.createTenant(ownerB.id, {
    name: "Organisation coffre Meta B",
    category: "Services",
  });
  const endpointA = await registerAuthorizedMetaWhatsAppEndpoint(
    db,
    {
      tenantId: tenantA.id,
      actorId: ownerA.id,
      externalAccountId: wabaId,
      phoneNumberId,
      occurredAt: timestamp,
    },
    fingerprintSecret,
  );
  const endpointB = await registerAuthorizedMetaWhatsAppEndpoint(
    db,
    {
      tenantId: tenantB.id,
      actorId: ownerB.id,
      externalAccountId: "345678901234567",
      phoneNumberId: "456789012345678",
      occurredAt: timestamp,
    },
    fingerprintSecret,
  );
  const identityA = await seedMetaIdentity(db, tenantA.id, "a");
  await reserveMetaWhatsAppIdentityBinding(db, {
    id: id("binding"),
    tenantId: tenantA.id,
    endpointId: endpointA.endpointId,
    channelIdentityId: identityA,
    createdAt: timestamp,
  });
  return { db, ownerA, ownerB, tenantA, tenantB, endpointA, endpointB, identityA };
}

async function seedMetaIdentity(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  tenantId: string,
  suffix: string,
) {
  const participantId = id("participant");
  const identityId = id("identity");
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ($1, $2, 'customer', null, $3, $3)`,
    [participantId, tenantId, timestamp],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values ($1, $2, $3, 'messaging', 'whatsapp-meta', $4, null,
       'customer', 'active', $5, $5)`,
    [identityId, tenantId, participantId, `meta-vault-subject-${suffix}`, timestamp],
  );
  return identityId;
}

function keyringV1() {
  return createChannelProviderSecretKeyring({
    activeKeyVersion: "test-v1",
    keys: { "test-v1": Buffer.alloc(32, 11) },
  });
}

function endpointRotationInput(
  setup: Awaited<ReturnType<typeof createSetup>>,
  rotationKey: string,
  overrides: Partial<{
    wabaId: string;
    accessToken: string;
    occurredAt: string;
  }> = {},
) {
  return {
    tenantId: setup.tenantA.id,
    actorId: setup.ownerA.id,
    endpointId: setup.endpointA.endpointId,
    rotationKey,
    secret: {
      wabaId: overrides.wabaId ?? wabaId,
      accessToken: overrides.accessToken ?? accessToken,
      phoneNumberId,
      graphApiVersion: "v23.0",
      appSecret,
      webhookVerifyToken,
    },
    occurredAt: overrides.occurredAt ?? timestamp,
  };
}

function rotateEndpoint(
  setup: Awaited<ReturnType<typeof createSetup>>,
  keyring: ReturnType<typeof keyringV1>,
  rotationKey: string,
) {
  return rotateMetaWhatsAppEndpointSecret(
    setup.db,
    endpointRotationInput(setup, rotationKey),
    keyring,
  );
}

function rotateIdentity(
  setup: Awaited<ReturnType<typeof createSetup>>,
  keyring: ReturnType<typeof keyringV1>,
  rotationKey: string,
) {
  return rotateMetaWhatsAppIdentitySecret(
    setup.db,
    {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: setup.endpointA.endpointId,
      channelIdentityId: setup.identityA,
      rotationKey,
      secret: { recipientPhoneNumber },
      occurredAt: timestamp,
    },
    keyring,
  );
}
