import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  createWhatsAppMetaTrialAuthorizationLoader,
  issueWhatsAppMetaTrialAuthorization,
  registerAuthorizedMetaWhatsAppEndpoint,
  revokeWhatsAppMetaTrialAuthorization,
  setAuthorizedMetaWhatsAppEndpointStatus,
  type WhatsAppMetaActivationAuthorizationError,
} from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const fingerprintSecret = "meta-trial-authorization-fingerprint-secret";
const authorizedAt = "2026-09-05T06:00:00.000Z";
const expiresAt = "2026-09-05T07:00:00.000Z";
const revokedAt = "2026-09-05T06:30:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("autorisation d’essai WhatsApp Meta tenant-aware", () => {
  it("émet une preuve d’un message, rejoue et audite sans donnée sensible", async () => {
    const setup = await createSetup();
    const first = await issueAuthorization(setup, "meta-trial-proof-one");
    const replay = await issueAuthorization(setup, "meta-trial-proof-one");

    expect(first).toMatchObject({
      endpointId: setup.endpointA.endpointId,
      scope: "meta_whatsapp_trial",
      maxMessages: 1,
      revoked: false,
      replayed: false,
    });
    expect(replay).toEqual({ ...first, replayed: true });
    const stored = await setup.db.query<Record<string, unknown>>(
      `select * from channel_provider_activation_authorizations
       where tenant_id = $1 and id = $2`,
      [setup.tenantA.id, first.authorizationId],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({
      provider: "whatsapp_meta",
      authorization_scope: "meta_whatsapp_trial",
      max_messages: 1,
      free_units_confirmed: true,
    });
    const audits = await setup.db.query<{
      action: string;
      safe_metadata: string;
    }>(
      `select action, safe_metadata from audit_logs
       where tenant_id = $1
         and action = 'channel.provider_activation_authorized'`,
      [setup.tenantA.id],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]?.safe_metadata).toContain("meta_whatsapp_trial");
    expect(JSON.stringify(audits.rows)).not.toMatch(
      /access.?token|app.?secret|phone|waba|body|content|ciphertext/i,
    );
  });

  it("détecte les conflits d’idempotence et révoque de façon monotone", async () => {
    const setup = await createSetup();
    const issued = await issueAuthorization(setup, "meta-trial-proof-revoke");

    await expect(
      issueWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: setup.endpointA.endpointId,
        idempotencyKey: "meta-trial-proof-revoke",
        freeUnitsConfirmed: true,
        expiresAt: "2026-09-05T08:00:00.000Z",
        occurredAt: authorizedAt,
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_authorization_idempotency_conflict",
    } satisfies Partial<WhatsAppMetaActivationAuthorizationError>);

    await expect(
      revokeWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        authorizationId: issued.authorizationId,
        occurredAt: revokedAt,
      }),
    ).resolves.toEqual({
      authorizationId: issued.authorizationId,
      revoked: true,
      replayed: false,
    });
    await expect(
      revokeWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        authorizationId: issued.authorizationId,
        occurredAt: revokedAt,
      }),
    ).resolves.toEqual({
      authorizationId: issued.authorizationId,
      revoked: false,
      replayed: true,
    });
    await expect(
      createWhatsAppMetaTrialAuthorizationLoader(setup.db)({
        tenantId: setup.tenantA.id,
        endpointId: setup.endpointA.endpointId,
        authorizationId: issued.authorizationId,
      }),
    ).resolves.toMatchObject({
      provider: "whatsapp_meta",
      scope: "meta_whatsapp_trial",
      maxMessages: 1,
      revokedAt,
    });
  });

  it("refuse rôle faible, endpoint inter-tenant, fenêtre invalide et endpoint suspendu", async () => {
    const setup = await createSetup();
    const reader = await setup.services.registerUser({
      name: "Lecture seule autorisation Meta",
      email: `meta-trial-reader-${opened.length}@example.test`,
      password: "Password!1",
    });
    await setup.db.query(
      `insert into memberships (tenant_id, user_id, role, created_at)
       values ($1, $2, 'read-only', $3)`,
      [setup.tenantA.id, reader.id, authorizedAt],
    );

    await expect(
      issueWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: reader.id,
        endpointId: setup.endpointA.endpointId,
        idempotencyKey: "meta-trial-reader-denied",
        freeUnitsConfirmed: true,
        expiresAt,
        occurredAt: authorizedAt,
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_authorization_access_denied",
    } satisfies Partial<WhatsAppMetaActivationAuthorizationError>);
    await expect(
      issueWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: setup.endpointB.endpointId,
        idempotencyKey: "meta-trial-cross-tenant",
        freeUnitsConfirmed: true,
        expiresAt,
        occurredAt: authorizedAt,
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_authorization_invalid",
    } satisfies Partial<WhatsAppMetaActivationAuthorizationError>);
    await expect(
      issueWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: setup.endpointA.endpointId,
        idempotencyKey: "meta-trial-invalid-window",
        freeUnitsConfirmed: true,
        expiresAt: authorizedAt,
        occurredAt: authorizedAt,
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_authorization_invalid",
    } satisfies Partial<WhatsAppMetaActivationAuthorizationError>);

    await setAuthorizedMetaWhatsAppEndpointStatus(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: setup.endpointA.endpointId,
      status: "disabled",
      occurredAt: revokedAt,
    });
    await expect(
      issueAuthorization(setup, "meta-trial-disabled-endpoint"),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_authorization_invalid",
    } satisfies Partial<WhatsAppMetaActivationAuthorizationError>);
  });

  it("ne charge jamais une autorisation d’un autre tenant", async () => {
    const setup = await createSetup();
    const authorizationB = await issueWhatsAppMetaTrialAuthorization(setup.db, {
      tenantId: setup.tenantB.id,
      actorId: setup.ownerB.id,
      endpointId: setup.endpointB.endpointId,
      idempotencyKey: "meta-trial-tenant-b",
      freeUnitsConfirmed: true,
      expiresAt,
      occurredAt: authorizedAt,
    });

    await expect(
      createWhatsAppMetaTrialAuthorizationLoader(setup.db)({
        tenantId: setup.tenantA.id,
        endpointId: setup.endpointA.endpointId,
        authorizationId: authorizationB.authorizationId,
      }),
    ).resolves.toBeNull();
  });
});

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const suffix = opened.length;
  const ownerA = await services.registerUser({
    name: "Responsable essai Meta A",
    email: `meta-trial-owner-a-${suffix}@example.test`,
    password: "Password!1",
  });
  const ownerB = await services.registerUser({
    name: "Responsable essai Meta B",
    email: `meta-trial-owner-b-${suffix}@example.test`,
    password: "Password!1",
  });
  const tenantA = await services.createTenant(ownerA.id, {
    name: "Organisation essai Meta A",
    category: "Services",
  });
  const tenantB = await services.createTenant(ownerB.id, {
    name: "Organisation essai Meta B",
    category: "Services",
  });
  const endpointA = await registerAuthorizedMetaWhatsAppEndpoint(
    db,
    {
      tenantId: tenantA.id,
      actorId: ownerA.id,
      externalAccountId: "315589313241560883",
      phoneNumberId: "8794189252778687",
      occurredAt: authorizedAt,
    },
    fingerprintSecret,
  );
  const endpointB = await registerAuthorizedMetaWhatsAppEndpoint(
    db,
    {
      tenantId: tenantB.id,
      actorId: ownerB.id,
      externalAccountId: "415589313241560883",
      phoneNumberId: "9794189252778687",
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
  return issueWhatsAppMetaTrialAuthorization(setup.db, {
    tenantId: setup.tenantA.id,
    actorId: setup.ownerA.id,
    endpointId: setup.endpointA.endpointId,
    idempotencyKey,
    freeUnitsConfirmed: true,
    expiresAt,
    occurredAt: authorizedAt,
  });
}
