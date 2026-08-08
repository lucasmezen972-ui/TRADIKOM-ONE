import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { id } from "../src/lib/security";
import {
  ChannelProviderSecretError,
  createChannelProviderSecretKeyring,
  createWhatsAppTwilioTransport,
  createWhatsAppTwilioSecretResolvers,
  registerAuthorizedWhatsAppEndpoint,
  revokeWhatsAppEndpointSecret,
  revokeWhatsAppIdentitySecret,
  rotateWhatsAppEndpointSecret,
  rotateWhatsAppIdentitySecret,
  setAuthorizedWhatsAppEndpointStatus,
} from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const fingerprintSecret = "vault-fingerprint-secret-at-least-32-bytes";
const timestamp = "2026-08-08T12:00:00.000Z";
const later = "2026-08-08T12:01:00.000Z";
const accountSid = `AC${"a".repeat(32)}`;
const authToken = "test-auth-token-32-bytes-minimum-value";
const senderAddress = "whatsapp:+15005550006";
const recipientAddress = "whatsapp:+596696000000";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("coffre fournisseur WhatsApp/Twilio tenant-aware", () => {
  it("résout éphémèrement credentials, sender et destination sans fuite persistée", async () => {
    const setup = await createSetup();
    const keyring = keyringV1();
    const endpoint = await rotateEndpoint(setup, keyring, "rotation-endpoint-1");
    const destination = await rotateDestination(
      setup,
      keyring,
      "rotation-destination-1",
    );
    const resolvers = createWhatsAppTwilioSecretResolvers(setup.db, keyring);

    expect(endpoint).toMatchObject({
      secretVersion: 1,
      active: true,
      replayed: false,
    });
    expect(destination).toMatchObject({
      secretVersion: 1,
      active: true,
      replayed: false,
    });
    await expect(
      resolvers.resolveCredentials({
        tenantId: setup.tenantA.id,
        endpointId: setup.endpointA.endpointId,
      }),
    ).resolves.toEqual({ accountSid, authToken });
    await expect(
      resolvers.resolveDestination({
        tenantId: setup.tenantA.id,
        endpointId: setup.endpointA.endpointId,
        channelIdentityId: setup.identityA,
      }),
    ).resolves.toEqual({ senderAddress, recipientAddress });

    const createMessage = vi.fn().mockResolvedValue({
      sid: `SM${"c".repeat(32)}`,
      status: "queued",
    });
    const transport = createWhatsAppTwilioTransport({
      state: "mock",
      statusCallbackUrl:
        "https://app.example.test/api/webhooks/twilio/whatsapp/status",
      ...resolvers,
      createClient: (credentials) => {
        expect(credentials).toEqual({ accountSid, authToken });
        return { messages: { create: createMessage } };
      },
    });
    await expect(
      transport.sendMessage({
        tenantId: setup.tenantA.id,
        endpointId: setup.endpointA.endpointId,
        channelIdentityId: setup.identityA,
        messageId: "message-vault-integration",
        idempotencyKey: "vault-integration-send",
        text: "Résultat métier de test.",
      }),
    ).resolves.toMatchObject({ status: "accepted" });
    expect(createMessage).toHaveBeenCalledWith({
      from: senderAddress,
      to: recipientAddress,
      body: "Résultat métier de test.",
      statusCallback:
        "https://app.example.test/api/webhooks/twilio/whatsapp/status",
    });

    const stored = await setup.db.query<{
      encrypted_payload: string;
      rotation_key_hash: string;
    }>("select encrypted_payload, rotation_key_hash from channel_provider_secret_versions");
    expect(stored.rows).toHaveLength(2);
    expect(JSON.stringify(stored.rows)).not.toContain(authToken);
    expect(JSON.stringify(stored.rows)).not.toContain(senderAddress);
    expect(JSON.stringify(stored.rows)).not.toContain(recipientAddress);
    expect(stored.rows.every((row) => /^[a-f0-9]{64}$/.test(row.rotation_key_hash))).toBe(
      true,
    );

    const audits = await setup.db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action = 'channel.provider_secret_rotated'`,
      [setup.tenantA.id],
    );
    expect(audits.rows).toHaveLength(2);
    expect(JSON.stringify(audits.rows)).not.toContain(accountSid);
    expect(JSON.stringify(audits.rows)).not.toContain(authToken);
    expect(JSON.stringify(audits.rows)).not.toContain(senderAddress);
    expect(JSON.stringify(audits.rows)).not.toContain(recipientAddress);
    expect(JSON.stringify({ endpoint, destination })).not.toContain(authToken);
  });

  it("rejoue une rotation identique et révoque l'ancienne version lors d'une rotation de clé", async () => {
    const setup = await createSetup();
    const v1 = keyringV1();
    const first = await rotateEndpoint(setup, v1, "rotation-endpoint-1");
    const replay = await rotateEndpoint(setup, v1, "rotation-endpoint-1");
    await expect(
      rotateWhatsAppEndpointSecret(
        setup.db,
        {
          tenantId: setup.tenantA.id,
          actorId: setup.ownerA.id,
          endpointId: setup.endpointA.endpointId,
          rotationKey: "rotation-endpoint-1",
          secret: {
            accountSid,
            authToken: `${authToken}-collision`,
            senderAddress,
          },
        },
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
    const second = await rotateWhatsAppEndpointSecret(
      setup.db,
      {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: setup.endpointA.endpointId,
        rotationKey: "rotation-endpoint-2",
        secret: {
          accountSid,
          authToken: `${authToken}-rotated`,
          senderAddress,
        },
        occurredAt: later,
      },
      v2,
    );

    expect(replay).toEqual({ ...first, replayed: true });
    expect(second).toMatchObject({
      secretVersion: 2,
      active: true,
      replayed: false,
    });
    const rows = await setup.db.query<{
      secret_version: number;
      key_version: string;
      revoked_at: string | null;
    }>(
      `select secret_version, key_version, revoked_at
       from channel_provider_secret_versions
       where tenant_id = $1 and secret_scope = 'endpoint'
       order by secret_version`,
      [setup.tenantA.id],
    );
    expect(rows.rows).toEqual([
      { secret_version: 1, key_version: "test-v1", revoked_at: later },
      { secret_version: 2, key_version: "test-v2", revoked_at: null },
    ]);
    await expect(
      createWhatsAppTwilioSecretResolvers(setup.db, v2).resolveCredentials({
        tenantId: setup.tenantA.id,
        endpointId: setup.endpointA.endpointId,
      }),
    ).resolves.toEqual({ accountSid, authToken: `${authToken}-rotated` });
    const auditCount = await setup.db.query<{ count: number }>(
      `select count(*)::int as count from audit_logs
       where tenant_id = $1 and action = 'channel.provider_secret_rotated'`,
      [setup.tenantA.id],
    );
    expect(auditCount.rows[0]?.count).toBe(2);
  });

  it("révoque de façon monotone et refuse les références désactivées", async () => {
    const setup = await createSetup();
    const keyring = keyringV1();
    await rotateEndpoint(setup, keyring, "rotation-endpoint-1");
    await rotateDestination(setup, keyring, "rotation-destination-1");

    await expect(
      revokeWhatsAppIdentitySecret(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: setup.endpointA.endpointId,
        channelIdentityId: setup.identityA,
        occurredAt: later,
      }),
    ).resolves.toEqual({ revoked: true, replayed: false });
    await expect(
      revokeWhatsAppIdentitySecret(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: setup.endpointA.endpointId,
        channelIdentityId: setup.identityA,
        occurredAt: later,
      }),
    ).resolves.toEqual({ revoked: false, replayed: true });
    await expect(
      createWhatsAppTwilioSecretResolvers(setup.db, keyring).resolveDestination({
        tenantId: setup.tenantA.id,
        endpointId: setup.endpointA.endpointId,
        channelIdentityId: setup.identityA,
      }),
    ).resolves.toBeNull();

    await setAuthorizedWhatsAppEndpointStatus(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: setup.endpointA.endpointId,
      status: "disabled",
      occurredAt: later,
    });
    await expect(
      createWhatsAppTwilioSecretResolvers(setup.db, keyring).resolveCredentials({
        tenantId: setup.tenantA.id,
        endpointId: setup.endpointA.endpointId,
      }),
    ).resolves.toBeNull();
    await expect(
      revokeWhatsAppEndpointSecret(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: setup.endpointA.endpointId,
        occurredAt: later,
      }),
    ).resolves.toEqual({ revoked: true, replayed: false });
  });

  it("refuse rôle insuffisant, endpoint inter-tenant et identité inactive", async () => {
    const setup = await createSetup();
    const keyring = keyringV1();
    const member = await setup.services.registerUser({
      name: "Membre coffre",
      email: "vault-member@example.test",
      password: "Password!1",
    });
    await setup.db.query(
      `insert into memberships (tenant_id, user_id, role, created_at)
       values ($1, $2, 'read-only', $3)`,
      [setup.tenantA.id, member.id, timestamp],
    );

    await expect(
      rotateWhatsAppEndpointSecret(
        setup.db,
        {
          tenantId: setup.tenantA.id,
          actorId: member.id,
          endpointId: setup.endpointA.endpointId,
          rotationKey: "rotation-member-denied",
          secret: { accountSid, authToken, senderAddress },
        },
        keyring,
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_secret_access_denied",
    } satisfies Partial<ChannelProviderSecretError>);
    await expect(
      rotateWhatsAppEndpointSecret(
        setup.db,
        {
          tenantId: setup.tenantA.id,
          actorId: setup.ownerA.id,
          endpointId: setup.endpointB.endpointId,
          rotationKey: "rotation-cross-tenant",
          secret: { accountSid, authToken, senderAddress },
        },
        keyring,
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_secret_reference_invalid",
    } satisfies Partial<ChannelProviderSecretError>);
    await expect(
      rotateWhatsAppEndpointSecret(
        setup.db,
        {
          tenantId: setup.tenantA.id,
          actorId: setup.ownerA.id,
          endpointId: setup.endpointA.endpointId,
          rotationKey: "rotation-account-mismatch",
          secret: {
            accountSid: `AC${"c".repeat(32)}`,
            authToken,
            senderAddress,
          },
        },
        keyring,
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_secret_reference_invalid",
    } satisfies Partial<ChannelProviderSecretError>);

    await setup.db.query(
      `update conversation_channel_identities set state = 'revoked', updated_at = $1
       where tenant_id = $2 and id = $3`,
      [later, setup.tenantA.id, setup.identityA],
    );
    await expect(
      rotateDestination(setup, keyring, "rotation-inactive-identity"),
    ).rejects.toMatchObject({
      code: "channel_provider_secret_reference_invalid",
    } satisfies Partial<ChannelProviderSecretError>);
    expect(
      (
        await setup.db.query(
          "select id from channel_provider_secret_versions where tenant_id = $1",
          [setup.tenantA.id],
        )
      ).rows,
    ).toEqual([]);
  });

  it("échoue fermé si la version de clé active stockée n'est plus disponible", async () => {
    const setup = await createSetup();
    await rotateEndpoint(setup, keyringV1(), "rotation-endpoint-1");
    const wrongKeyring = createChannelProviderSecretKeyring({
      activeKeyVersion: "test-v2",
      keys: { "test-v2": Buffer.alloc(32, 22) },
    });
    await expect(
      createWhatsAppTwilioSecretResolvers(
        setup.db,
        wrongKeyring,
      ).resolveCredentials({
        tenantId: setup.tenantA.id,
        endpointId: setup.endpointA.endpointId,
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_secret_crypto_failed",
    } satisfies Partial<ChannelProviderSecretError>);
  });
});

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const ownerA = await services.registerUser({
    name: "Propriétaire coffre A",
    email: "vault-owner-a@example.test",
    password: "Password!1",
  });
  const ownerB = await services.registerUser({
    name: "Propriétaire coffre B",
    email: "vault-owner-b@example.test",
    password: "Password!1",
  });
  const tenantA = await services.createTenant(ownerA.id, {
    name: "Organisation coffre A",
    category: "Services",
  });
  const tenantB = await services.createTenant(ownerB.id, {
    name: "Organisation coffre B",
    category: "Services",
  });
  const endpointA = await registerAuthorizedWhatsAppEndpoint(
    db,
    {
      tenantId: tenantA.id,
      actorId: ownerA.id,
      externalAccountId: accountSid,
      destinationAddress: senderAddress,
      occurredAt: timestamp,
    },
    fingerprintSecret,
  );
  const endpointB = await registerAuthorizedWhatsAppEndpoint(
    db,
    {
      tenantId: tenantB.id,
      actorId: ownerB.id,
      externalAccountId: `AC${"b".repeat(32)}`,
      destinationAddress: "whatsapp:+15005550007",
      occurredAt: timestamp,
    },
    fingerprintSecret,
  );
  const identityA = await seedIdentity(db, tenantA.id, "a");
  const identityB = await seedIdentity(db, tenantB.id, "b");
  return {
    db,
    services,
    ownerA,
    ownerB,
    tenantA,
    tenantB,
    endpointA,
    endpointB,
    identityA,
    identityB,
  };
}

async function seedIdentity(
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
     ) values ($1, $2, $3, 'messaging', 'whatsapp-twilio', $4, null,
       'customer', 'active', $5, $5)`,
    [identityId, tenantId, participantId, `vault-subject-${suffix}`, timestamp],
  );
  return identityId;
}

function keyringV1() {
  return createChannelProviderSecretKeyring({
    activeKeyVersion: "test-v1",
    keys: { "test-v1": Buffer.alloc(32, 11) },
  });
}

function rotateEndpoint(
  setup: Awaited<ReturnType<typeof createSetup>>,
  keyring: ReturnType<typeof keyringV1>,
  idempotencyKey: string,
) {
  return rotateWhatsAppEndpointSecret(
    setup.db,
    {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: setup.endpointA.endpointId,
      rotationKey: idempotencyKey,
      secret: { accountSid, authToken, senderAddress },
      occurredAt: timestamp,
    },
    keyring,
  );
}

function rotateDestination(
  setup: Awaited<ReturnType<typeof createSetup>>,
  keyring: ReturnType<typeof keyringV1>,
  idempotencyKey: string,
) {
  return rotateWhatsAppIdentitySecret(
    setup.db,
    {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: setup.endpointA.endpointId,
      channelIdentityId: setup.identityA,
      rotationKey: idempotencyKey,
      secret: { recipientAddress },
      occurredAt: timestamp,
    },
    keyring,
  );
}
