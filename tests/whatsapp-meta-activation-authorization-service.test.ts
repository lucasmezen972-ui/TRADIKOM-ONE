import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { hashToken, id } from "../src/lib/security";
import {
  createChannelProviderSecretKeyring,
  createWhatsAppMetaTrialAuthorizationLoader,
  inspectMetaWhatsAppTenantReadiness,
  issueCurrentWhatsAppMetaTrialAuthorization,
  issueWhatsAppMetaTrialAuthorization,
  registerAuthorizedMetaWhatsAppEndpoint,
  reserveWhatsAppMetaTrialBudget,
  reserveWhatsAppOutboundDelivery,
  revokeCurrentWhatsAppMetaTrialAuthorization,
  revokeMetaWhatsAppEndpointSecret,
  revokeWhatsAppMetaTrialAuthorization,
  rotateMetaWhatsAppEndpointSecret,
  setAuthorizedMetaWhatsAppEndpointStatus,
  type WhatsAppMetaActivationAuthorizationError,
} from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const fingerprintSecret = "meta-trial-authorization-fingerprint-secret";
const authorizedAt = "2026-09-05T06:00:00.000Z";
const expiresAt = "2026-09-05T07:00:00.000Z";
const revokedAt = "2026-09-05T06:30:00.000Z";
const metaSecretKeyring = createChannelProviderSecretKeyring({
  activeKeyVersion: "test-v1",
  keys: { "test-v1": Buffer.alloc(32, 57) },
});

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

  it("sélectionne exactement un endpoint, refuse une seconde clé et rejoue la clé persistée après reconfiguration", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const setup = await createSetup();

    await expect(
      issueCurrentWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        idempotencyKey: "meta-current-no-configured-endpoint",
        freeUnitsConfirmed: true,
        occurredAt: authorizedAt,
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_authorization_invalid",
    } satisfies Partial<WhatsAppMetaActivationAuthorizationError>);

    await configureMetaEndpoint(setup, {
      endpointId: setup.endpointA.endpointId,
      wabaId: "315589313241560883",
      phoneNumberId: "8794189252778687",
      suffix: "one",
    });
    const first = await issueCurrentWhatsAppMetaTrialAuthorization(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      idempotencyKey: "meta-current-single-endpoint",
      freeUnitsConfirmed: true,
      occurredAt: authorizedAt,
    });
    const replay = await issueCurrentWhatsAppMetaTrialAuthorization(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      idempotencyKey: "meta-current-single-endpoint",
      freeUnitsConfirmed: true,
      occurredAt: "2026-09-05T06:01:00.000Z",
    });
    await expect(
      issueCurrentWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        idempotencyKey: "meta-current-second-key-denied",
        freeUnitsConfirmed: true,
        occurredAt: "2026-09-05T06:02:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_authorization_invalid",
    } satisfies Partial<WhatsAppMetaActivationAuthorizationError>);

    expect(first).toMatchObject({
      endpointId: setup.endpointA.endpointId,
      maxMessages: 1,
      replayed: false,
      reused: false,
    });
    expect(replay).toEqual({ ...first, replayed: true });

    const secondEndpoint = await registerAuthorizedMetaWhatsAppEndpoint(
      setup.db,
      {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        externalAccountId: "515589313241560885",
        phoneNumberId: "6794189252778689",
        occurredAt: authorizedAt,
      },
      fingerprintSecret,
    );
    await configureMetaEndpoint(setup, {
      endpointId: secondEndpoint.endpointId,
      wabaId: "515589313241560885",
      phoneNumberId: "6794189252778689",
      suffix: "two",
    });
    await expect(
      issueCurrentWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        idempotencyKey: "meta-current-single-endpoint",
        freeUnitsConfirmed: true,
        occurredAt: "2026-09-05T06:03:00.000Z",
      }),
    ).resolves.toEqual({ ...first, replayed: true });
    await expect(
      issueCurrentWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        idempotencyKey: "meta-current-ambiguous-endpoints",
        freeUnitsConfirmed: true,
        occurredAt: "2026-09-05T06:04:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_authorization_invalid",
    } satisfies Partial<WhatsAppMetaActivationAuthorizationError>);
    const counts = await setup.db.query<{
      authorization_count: number;
      authorization_audit_count: number;
    }>(
      `select
         (select count(*)::int
            from channel_provider_activation_authorizations
           where tenant_id = $1 and provider = 'whatsapp_meta')
           as authorization_count,
         (select count(*)::int
            from audit_logs
           where tenant_id = $1
             and action = 'channel.provider_activation_authorized')
           as authorization_audit_count`,
      [setup.tenantA.id],
    );
    expect(counts.rows[0]).toEqual({
      authorization_count: 1,
      authorization_audit_count: 1,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("réserve les commandes courantes aux propriétaires et administrateurs", async () => {
    const setup = await createSetup();
    await configureMetaEndpoint(setup, {
      endpointId: setup.endpointA.endpointId,
      wabaId: "315589313241560883",
      phoneNumberId: "8794189252778687",
      suffix: "roles",
    });
    const manager = await setup.services.registerUser({
      name: "Gestionnaire sans autorisation Meta",
      email: `meta-current-manager-${opened.length}@example.test`,
      password: "Password!1",
    });
    const administrator = await setup.services.registerUser({
      name: "Administrateur autorisation Meta",
      email: `meta-current-admin-${opened.length}@example.test`,
      password: "Password!1",
    });
    await setup.db.query(
      `insert into memberships (tenant_id, user_id, role, created_at)
       values ($1, $2, 'manager', $4), ($1, $3, 'administrator', $4)`,
      [setup.tenantA.id, manager.id, administrator.id, authorizedAt],
    );

    await expect(
      issueCurrentWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: manager.id,
        idempotencyKey: "meta-current-manager-denied",
        freeUnitsConfirmed: true,
        occurredAt: authorizedAt,
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_authorization_access_denied",
    } satisfies Partial<WhatsAppMetaActivationAuthorizationError>);

    await expect(
      issueCurrentWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: administrator.id,
        idempotencyKey: "meta-current-administrator-allowed",
        freeUnitsConfirmed: true,
        occurredAt: authorizedAt,
      }),
    ).resolves.toMatchObject({ replayed: false, reused: false });

    await expect(
      revokeCurrentWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: manager.id,
        occurredAt: "2026-09-05T06:01:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_authorization_access_denied",
    } satisfies Partial<WhatsAppMetaActivationAuthorizationError>);
    await expect(
      revokeCurrentWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        occurredAt: "2026-09-05T06:01:00.000Z",
      }),
    ).resolves.toMatchObject({ revokedCount: 1, replayed: false });
  });

  it("refuse toute nouvelle autorisation après consommation sans mutation ni nouvel audit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const setup = await createSetup();
    await configureMetaEndpoint(setup, {
      endpointId: setup.endpointA.endpointId,
      wabaId: "315589313241560883",
      phoneNumberId: "8794189252778687",
      suffix: "consumed",
    });
    const issued = await issueCurrentWhatsAppMetaTrialAuthorization(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      idempotencyKey: "meta-current-consumed-once",
      freeUnitsConfirmed: true,
      validForSeconds: 3_600,
      occurredAt: authorizedAt,
    });
    await consumeTrialAuthorization(setup, issued.authorizationId);

    await expect(
      issueCurrentWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        idempotencyKey: "meta-current-consumed-forged-new-key",
        freeUnitsConfirmed: true,
        validForSeconds: 3_600,
        occurredAt: "2026-09-05T06:05:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_authorization_invalid",
    } satisfies Partial<WhatsAppMetaActivationAuthorizationError>);
    await expect(
      issueCurrentWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        idempotencyKey: "meta-current-consumed-once",
        freeUnitsConfirmed: true,
        validForSeconds: 3_600,
        occurredAt: "2026-09-05T06:05:00.000Z",
      }),
    ).resolves.toMatchObject({
      authorizationId: issued.authorizationId,
      replayed: true,
      reused: false,
    });
    const counts = await setup.db.query<{
      authorization_count: number;
      authorization_audit_count: number;
    }>(
      `select
         (select count(*)::int
            from channel_provider_activation_authorizations
           where tenant_id = $1 and provider = 'whatsapp_meta')
           as authorization_count,
         (select count(*)::int
            from audit_logs
           where tenant_id = $1
             and action = 'channel.provider_activation_authorized')
           as authorization_audit_count`,
      [setup.tenantA.id],
    );
    expect(counts.rows[0]).toEqual({
      authorization_count: 1,
      authorization_audit_count: 1,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("révoque à l’échelle du tenant sans secret ni endpoint actif et reste idempotente", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const setup = await createSetup();
    await configureMetaEndpoint(setup, {
      endpointId: setup.endpointA.endpointId,
      wabaId: "315589313241560883",
      phoneNumberId: "8794189252778687",
      suffix: "readiness",
    });
    const observedAt = new Date(authorizedAt);
    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantA.id,
        observedAt,
      ),
    ).resolves.toMatchObject({
      state: "ready",
      checks: { trialAuthorization: "required" },
    });

    const issued = await issueCurrentWhatsAppMetaTrialAuthorization(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      idempotencyKey: "meta-current-readiness-first",
      freeUnitsConfirmed: true,
      validForSeconds: 3_600,
      occurredAt: authorizedAt,
    });
    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantA.id,
        new Date("2026-09-05T06:01:00.000Z"),
      ),
    ).resolves.toMatchObject({
      state: "ready",
      checks: { trialAuthorization: "valid" },
    });

    const secondEndpoint = await registerAuthorizedMetaWhatsAppEndpoint(
      setup.db,
      {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        externalAccountId: "515589313241560885",
        phoneNumberId: "6794189252778689",
        occurredAt: authorizedAt,
      },
      fingerprintSecret,
    );
    await configureMetaEndpoint(setup, {
      endpointId: secondEndpoint.endpointId,
      wabaId: "515589313241560885",
      phoneNumberId: "6794189252778689",
      suffix: "revocation-disabled",
    });
    const secondIssued = await issueWhatsAppMetaTrialAuthorization(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: secondEndpoint.endpointId,
      idempotencyKey: "meta-current-readiness-second",
      freeUnitsConfirmed: true,
      expiresAt,
      occurredAt: authorizedAt,
    });
    await expect(
      revokeMetaWhatsAppEndpointSecret(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: setup.endpointA.endpointId,
        occurredAt: "2026-09-05T06:01:30.000Z",
      }),
    ).resolves.toEqual({ revoked: true, replayed: false });
    await expect(
      setAuthorizedMetaWhatsAppEndpointStatus(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: secondEndpoint.endpointId,
        status: "disabled",
        occurredAt: "2026-09-05T06:01:45.000Z",
      }),
    ).resolves.toMatchObject({ status: "disabled", replayed: false });

    const revoked = await revokeCurrentWhatsAppMetaTrialAuthorization(
      setup.db,
      {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        occurredAt: "2026-09-05T06:02:00.000Z",
      },
    );
    expect(revoked).toMatchObject({
      revokedCount: 2,
      replayed: false,
    });
    await expect(
      revokeCurrentWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        occurredAt: "2026-09-05T06:03:00.000Z",
      }),
    ).resolves.toMatchObject({
      revokedCount: 0,
      replayed: true,
    });

    const stored = await setup.db.query<{
      id: string;
      revoked_at: string | null;
    }>(
      `select id, revoked_at
         from channel_provider_activation_authorizations
        where tenant_id = $1 and provider = 'whatsapp_meta'
        order by id`,
      [setup.tenantA.id],
    );
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.every((row) => row.revoked_at !== null)).toBe(true);
    expect(stored.rows.map((row) => row.id)).toEqual(
      expect.arrayContaining([
        issued.authorizationId,
        secondIssued.authorizationId,
      ]),
    );
    const audits = await setup.db.query<{
      action: string;
      safe_metadata: string;
    }>(
      `select action, safe_metadata
         from audit_logs
        where tenant_id = $1
          and action in (
            'channel.provider_activation_authorized',
            'channel.provider_activation_revoked'
          )`,
      [setup.tenantA.id],
    );
    expect(audits.rows.filter((row) => row.action.endsWith("_revoked"))).toHaveLength(2);
    expect(JSON.stringify(audits.rows)).not.toMatch(
      /test-token-never-real|app-secret|webhook-token|phoneNumberId|wabaId/i,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
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

async function configureMetaEndpoint(
  setup: Awaited<ReturnType<typeof createSetup>>,
  input: {
    endpointId: string;
    wabaId: string;
    phoneNumberId: string;
    suffix: string;
  },
) {
  return rotateMetaWhatsAppEndpointSecret(
    setup.db,
    {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: input.endpointId,
      rotationKey: `meta-current-${input.suffix}`,
      secret: {
        wabaId: input.wabaId,
        accessToken: `meta-current-${input.suffix}-test-token-never-real`,
        phoneNumberId: input.phoneNumberId,
        graphApiVersion: "v23.0",
        appSecret: `meta-current-${input.suffix}-app-secret-never-real`,
        webhookVerifyToken: `meta-current-${input.suffix}-webhook-token-never-real`,
      },
      occurredAt: "2026-09-05T05:59:00.000Z",
    },
    metaSecretKeyring,
    fingerprintSecret,
  );
}

async function consumeTrialAuthorization(
  setup: Awaited<ReturnType<typeof createSetup>>,
  authorizationId: string,
) {
  const suffix = opened.length;
  const participantId = `participant_meta_current_${suffix}`;
  const identityId = `identity_meta_current_${suffix}`;
  const threadId = `thread_meta_current_${suffix}`;
  const messageId = `message_meta_current_${suffix}`;
  await setup.db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ($1, $2, 'customer', 'Contact essai Meta', $3, $3)`,
    [participantId, setup.tenantA.id, authorizedAt],
  );
  await setup.db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values (
       $1, $2, $3, 'messaging', 'whatsapp-meta', $4,
       'Contact essai Meta', 'customer', 'active', $5, $5
     )`,
    [
      identityId,
      setup.tenantA.id,
      participantId,
      `meta_current_subject_${suffix}`,
      authorizedAt,
    ],
  );
  await setup.db.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, created_at, updated_at, last_message_at
     ) values ($1, $2, 'open', null, $3, $3, $3)`,
    [threadId, setup.tenantA.id, authorizedAt],
  );
  await setup.db.query(
    `insert into conversation_thread_participants (
       tenant_id, thread_id, channel_identity_id, joined_at
     ) values ($1, $2, $3, $4)`,
    [setup.tenantA.id, threadId, identityId, authorizedAt],
  );
  await setup.db.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, causation_id, safe_error_code, occurred_at, created_at
     ) values (
       $1, $2, $3, $4, 'outbound', 'result', 'pending',
       'Résultat métier d’essai', 'web-chat', null, $5, $6,
       null, null, $7, $7
     )`,
    [
      messageId,
      setup.tenantA.id,
      threadId,
      identityId,
      `canonical:${messageId}`,
      `correlation:${messageId}`,
      authorizedAt,
    ],
  );
  const deliveryId = id("channel_delivery");
  await reserveWhatsAppOutboundDelivery(setup.db, {
    id: deliveryId,
    tenantId: setup.tenantA.id,
    endpointId: setup.endpointA.endpointId,
    messageId,
    channelIdentityId: identityId,
    idempotencyKey: `meta-current-consumption-${suffix}`,
    requestFingerprint: hashToken(`meta-current-consumption-${suffix}`),
    actorId: setup.ownerA.id,
    occurredAt: authorizedAt,
    maxAttempts: 1,
    activationAuthorizationId: authorizationId,
    provider: "whatsapp_meta",
  });
  await reserveWhatsAppMetaTrialBudget(setup.db, setup.ownerA.id, {
    tenantId: setup.tenantA.id,
    endpointId: setup.endpointA.endpointId,
    authorizationId,
    deliveryId,
    occurredAt: authorizedAt,
  });
}
