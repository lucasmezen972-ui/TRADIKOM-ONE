import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  createWhatsAppTwilioActivationAuthorizationLoader,
  issueWhatsAppTwilioActivationAuthorization,
  registerAuthorizedWhatsAppEndpoint,
  revokeWhatsAppTwilioActivationAuthorization,
  setAuthorizedWhatsAppEndpointStatus,
  type WhatsAppTwilioActivationAuthorizationError,
} from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const fingerprintSecret = "activation-fingerprint-secret-at-least-32-bytes";
const authorizedAt = "2026-08-08T16:00:00.000Z";
const expiresAt = "2026-08-08T17:00:00.000Z";
const revokedAt = "2026-08-08T16:30:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("autorisation d'activation WhatsApp/Twilio tenant-aware", () => {
  it("persiste et charge une preuve interne bornée avec audit sûr", async () => {
    const setup = await createSetup();
    const issued = await issueAuthorization(setup, "activation-proof-1");
    const stored = await createWhatsAppTwilioActivationAuthorizationLoader(
      setup.db,
    )({
      tenantId: setup.tenantA.id,
      endpointId: setup.endpointA.endpointId,
      authorizationId: issued.authorizationId,
    });

    expect(issued).toMatchObject({
      endpointId: setup.endpointA.endpointId,
      scope: "twilio_whatsapp_sandbox",
      maxMessages: 2,
      expiresAt,
      revoked: false,
      replayed: false,
    });
    expect(stored).toEqual({
      authorizationId: issued.authorizationId,
      tenantId: setup.tenantA.id,
      endpointId: setup.endpointA.endpointId,
      provider: "whatsapp_twilio",
      scope: "twilio_whatsapp_sandbox",
      maxMessages: 2,
      freeUnitsConfirmed: true,
      authorizedBy: setup.ownerA.id,
      authorizedAt,
      expiresAt,
      revokedAt: null,
    });

    const rows = await setup.db.query<{
      idempotency_key_hash: string;
    }>("select idempotency_key_hash from channel_provider_activation_authorizations");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.idempotency_key_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(rows.rows)).not.toContain("activation-proof-1");

    const audits = await setup.db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1
         and action = 'channel.provider_activation_authorized'`,
      [setup.tenantA.id],
    );
    expect(audits.rows).toHaveLength(1);
    expect(JSON.stringify(audits.rows)).not.toMatch(
      /account|sid|token|phone|number|address|url|body|content|ciphertext|activation-proof/i,
    );
  });

  it("rejoue une émission identique, refuse une collision et révoque monotoniquement", async () => {
    const setup = await createSetup();
    const first = await issueAuthorization(setup, "activation-proof-1");
    const replay = await issueAuthorization(setup, "activation-proof-1");
    expect(replay).toEqual({ ...first, replayed: true });

    await expect(
      issueWhatsAppTwilioActivationAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: setup.endpointA.endpointId,
        idempotencyKey: "activation-proof-1",
        maxMessages: 1,
        freeUnitsConfirmed: true,
        expiresAt,
        occurredAt: authorizedAt,
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_authorization_idempotency_conflict",
    } satisfies Partial<WhatsAppTwilioActivationAuthorizationError>);

    await expect(
      revokeWhatsAppTwilioActivationAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        authorizationId: first.authorizationId,
        occurredAt: revokedAt,
      }),
    ).resolves.toEqual({
      authorizationId: first.authorizationId,
      revoked: true,
      replayed: false,
    });
    await expect(
      revokeWhatsAppTwilioActivationAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        authorizationId: first.authorizationId,
        occurredAt: revokedAt,
      }),
    ).resolves.toEqual({
      authorizationId: first.authorizationId,
      revoked: false,
      replayed: true,
    });

    const stored = await createWhatsAppTwilioActivationAuthorizationLoader(
      setup.db,
    )({
      tenantId: setup.tenantA.id,
      endpointId: setup.endpointA.endpointId,
      authorizationId: first.authorizationId,
    });
    expect(stored?.revokedAt).toBe(revokedAt);
    const auditCount = await setup.db.query<{ count: number }>(
      `select count(*)::int as count from audit_logs
       where tenant_id = $1 and action like 'channel.provider_activation_%'`,
      [setup.tenantA.id],
    );
    expect(auditCount.rows[0]?.count).toBe(2);
  });

  it("autorise propriétaire ou administrateur et refuse rôle faible ou endpoint inter-tenant", async () => {
    const setup = await createSetup();
    const administrator = await setup.services.registerUser({
      name: "Administratrice activation",
      email: "activation-admin@example.test",
      password: "Password!1",
    });
    const reader = await setup.services.registerUser({
      name: "Lecteur activation",
      email: "activation-reader@example.test",
      password: "Password!1",
    });
    await setup.db.query(
      `insert into memberships (tenant_id, user_id, role, created_at)
       values ($1, $2, 'administrator', $4), ($1, $3, 'read-only', $4)`,
      [setup.tenantA.id, administrator.id, reader.id, authorizedAt],
    );

    await expect(
      issueWhatsAppTwilioActivationAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: administrator.id,
        endpointId: setup.endpointA.endpointId,
        idempotencyKey: "activation-proof-admin",
        maxMessages: 1,
        freeUnitsConfirmed: true,
        expiresAt,
        occurredAt: authorizedAt,
      }),
    ).resolves.toMatchObject({ replayed: false, maxMessages: 1 });
    await expect(
      issueWhatsAppTwilioActivationAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: reader.id,
        endpointId: setup.endpointA.endpointId,
        idempotencyKey: "activation-proof-reader",
        maxMessages: 1,
        freeUnitsConfirmed: true,
        expiresAt,
        occurredAt: authorizedAt,
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_authorization_access_denied",
    } satisfies Partial<WhatsAppTwilioActivationAuthorizationError>);
    await expect(
      issueWhatsAppTwilioActivationAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: setup.endpointB.endpointId,
        idempotencyKey: "activation-proof-cross-tenant",
        maxMessages: 1,
        freeUnitsConfirmed: true,
        expiresAt,
        occurredAt: authorizedAt,
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_authorization_invalid",
    } satisfies Partial<WhatsAppTwilioActivationAuthorizationError>);
  });

  it("refuse une fenêtre expirée, un endpoint désactivé et toute lecture hors tenant", async () => {
    const setup = await createSetup();
    await expect(
      issueWhatsAppTwilioActivationAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: setup.endpointA.endpointId,
        idempotencyKey: "activation-proof-expired",
        maxMessages: 1,
        freeUnitsConfirmed: true,
        expiresAt: authorizedAt,
        occurredAt: authorizedAt,
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_authorization_invalid",
    } satisfies Partial<WhatsAppTwilioActivationAuthorizationError>);

    await setAuthorizedWhatsAppEndpointStatus(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: setup.endpointA.endpointId,
      status: "disabled",
      occurredAt: revokedAt,
    });
    await expect(
      issueAuthorization(setup, "activation-proof-disabled"),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_authorization_invalid",
    } satisfies Partial<WhatsAppTwilioActivationAuthorizationError>);

    const issuedB = await issueWhatsAppTwilioActivationAuthorization(setup.db, {
      tenantId: setup.tenantB.id,
      actorId: setup.ownerB.id,
      endpointId: setup.endpointB.endpointId,
      idempotencyKey: "activation-proof-tenant-b",
      maxMessages: 1,
      freeUnitsConfirmed: true,
      expiresAt,
      occurredAt: authorizedAt,
    });
    const loader = createWhatsAppTwilioActivationAuthorizationLoader(setup.db);
    await expect(
      loader({
        tenantId: setup.tenantA.id,
        endpointId: setup.endpointA.endpointId,
        authorizationId: issuedB.authorizationId,
      }),
    ).resolves.toBeNull();
  });
});

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const ownerA = await services.registerUser({
    name: "Propriétaire activation A",
    email: "activation-owner-a@example.test",
    password: "Password!1",
  });
  const ownerB = await services.registerUser({
    name: "Propriétaire activation B",
    email: "activation-owner-b@example.test",
    password: "Password!1",
  });
  const tenantA = await services.createTenant(ownerA.id, {
    name: "Organisation activation A",
    category: "Services",
  });
  const tenantB = await services.createTenant(ownerB.id, {
    name: "Organisation activation B",
    category: "Services",
  });
  const endpointA = await registerAuthorizedWhatsAppEndpoint(
    db,
    {
      tenantId: tenantA.id,
      actorId: ownerA.id,
      externalAccountId: `AC${"a".repeat(32)}`,
      destinationAddress: "whatsapp:+15005550006",
      occurredAt: authorizedAt,
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
      occurredAt: authorizedAt,
    },
    fingerprintSecret,
  );
  return { db, services, ownerA, ownerB, tenantA, tenantB, endpointA, endpointB };
}

function issueAuthorization(
  setup: Awaited<ReturnType<typeof createSetup>>,
  idempotencyKey: string,
) {
  return issueWhatsAppTwilioActivationAuthorization(setup.db, {
    tenantId: setup.tenantA.id,
    actorId: setup.ownerA.id,
    endpointId: setup.endpointA.endpointId,
    idempotencyKey,
    maxMessages: 2,
    freeUnitsConfirmed: true,
    expiresAt,
    occurredAt: authorizedAt,
  });
}
