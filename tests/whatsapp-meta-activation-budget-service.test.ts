import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { hashToken, id } from "../src/lib/security";
import {
  issueWhatsAppMetaTrialAuthorization,
  registerAuthorizedMetaWhatsAppEndpoint,
  reserveMetaWhatsAppIdentityBinding,
  reserveWhatsAppMetaTrialBudget,
  reserveWhatsAppOutboundDelivery,
  revokeWhatsAppMetaTrialAuthorization,
  type WhatsAppMetaActivationBudgetError,
} from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const timestamp = "2026-09-05T06:00:00.000Z";
const later = "2026-09-05T06:05:00.000Z";
const expiresAt = "2026-09-05T07:00:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("budget d’essai WhatsApp Meta tenant-aware", () => {
  it("consomme une unité et rejoue sans seconde consommation", async () => {
    const setup = await createSetup();
    const deliveryId = await reserveDelivery(setup, "meta-trial-budget-one");
    const input = budgetInput(setup, deliveryId, timestamp);

    const first = await reserveWhatsAppMetaTrialBudget(
      setup.db,
      setup.owner.id,
      input,
    );
    const replay = await reserveWhatsAppMetaTrialBudget(
      setup.db,
      setup.owner.id,
      input,
    );

    expect(first).toMatchObject({
      authorizationId: setup.authorizationId,
      deliveryId,
      usedMessages: 1,
      remainingMessages: 0,
      replayed: false,
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await countConsumptions(setup)).toBe(1);
    const audits = await setup.db.query<{
      action: string;
      safe_metadata: string;
    }>(
      `select action, safe_metadata from audit_logs
       where tenant_id = $1
         and action = 'channel.provider_activation_budget_consumed'`,
      [setup.tenant.id],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]?.safe_metadata).toContain("meta_whatsapp_trial");
    expect(JSON.stringify(audits.rows)).not.toMatch(
      /token|secret|phone|waba|address|body|content|ciphertext/i,
    );
  });

  it("refuse atomiquement une seconde livraison", async () => {
    const setup = await createSetup();
    const first = await reserveDelivery(setup, "meta-trial-budget-first");
    const second = await reserveDelivery(setup, "meta-trial-budget-second");
    await reserveWhatsAppMetaTrialBudget(
      setup.db,
      setup.owner.id,
      budgetInput(setup, first, timestamp),
    );

    await expect(
      reserveWhatsAppMetaTrialBudget(
        setup.db,
        setup.owner.id,
        budgetInput(setup, second, later),
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_budget_exhausted",
    } satisfies Partial<WhatsAppMetaActivationBudgetError>);
    expect(await countConsumptions(setup)).toBe(1);
  });

  it.each(["expired", "revoked"] as const)(
    "reconnaît la consommation existante après une autorisation %s",
    async (mode) => {
      const setup = await createSetup();
      const deliveryId = await reserveDelivery(
        setup,
        `meta-trial-budget-replay-${mode}`,
      );
      const first = await reserveWhatsAppMetaTrialBudget(
        setup.db,
        setup.owner.id,
        budgetInput(setup, deliveryId, timestamp),
      );
      if (mode === "revoked") {
        await revokeWhatsAppMetaTrialAuthorization(setup.db, {
          tenantId: setup.tenant.id,
          actorId: setup.owner.id,
          authorizationId: setup.authorizationId,
          occurredAt: later,
        });
      }

      const replay = await reserveWhatsAppMetaTrialBudget(
        setup.db,
        setup.owner.id,
        budgetInput(setup, deliveryId, expiresAt),
      );

      expect(replay).toEqual({ ...first, replayed: true });
      expect(await countConsumptions(setup)).toBe(1);
    },
  );

  it("refuse une autorisation absente, expirée ou révoquée", async () => {
    const missing = await createSetup();
    const missingDelivery = await reserveDelivery(
      missing,
      "meta-trial-budget-missing",
      false,
    );
    await expect(
      reserveWhatsAppMetaTrialBudget(missing.db, missing.owner.id, {
        tenantId: missing.tenant.id,
        endpointId: missing.endpointId,
        deliveryId: missingDelivery,
        occurredAt: timestamp,
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_budget_invalid",
    } satisfies Partial<WhatsAppMetaActivationBudgetError>);

    const expired = await createSetup();
    const expiredDelivery = await reserveDelivery(
      expired,
      "meta-trial-budget-expired",
    );
    await expect(
      reserveWhatsAppMetaTrialBudget(
        expired.db,
        expired.owner.id,
        budgetInput(expired, expiredDelivery, expiresAt),
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_budget_invalid",
    } satisfies Partial<WhatsAppMetaActivationBudgetError>);

    const revoked = await createSetup();
    const revokedDelivery = await reserveDelivery(
      revoked,
      "meta-trial-budget-revoked",
    );
    await revokeWhatsAppMetaTrialAuthorization(revoked.db, {
      tenantId: revoked.tenant.id,
      actorId: revoked.owner.id,
      authorizationId: revoked.authorizationId,
      occurredAt: later,
    });
    await expect(
      reserveWhatsAppMetaTrialBudget(
        revoked.db,
        revoked.owner.id,
        budgetInput(revoked, revokedDelivery, later),
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_budget_invalid",
    } satisfies Partial<WhatsAppMetaActivationBudgetError>);
  });

  it("refuse une autorisation différente de celle liée à la livraison", async () => {
    const setup = await createSetup();
    const deliveryId = await reserveDelivery(
      setup,
      "meta-trial-budget-mismatched-authorization",
    );
    const otherAuthorization = await issueWhatsAppMetaTrialAuthorization(
      setup.db,
      {
        tenantId: setup.tenant.id,
        actorId: setup.owner.id,
        endpointId: setup.endpointId,
        idempotencyKey: "meta-trial-budget-other-authorization",
        freeUnitsConfirmed: true,
        expiresAt,
        occurredAt: timestamp,
      },
    );

    await expect(
      reserveWhatsAppMetaTrialBudget(setup.db, setup.owner.id, {
        tenantId: setup.tenant.id,
        endpointId: setup.endpointId,
        authorizationId: otherAuthorization.authorizationId,
        deliveryId,
        occurredAt: timestamp,
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_budget_invalid",
    } satisfies Partial<WhatsAppMetaActivationBudgetError>);
    expect(await countConsumptions(setup)).toBe(0);
  });
});

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const suffix = opened.length;
  const owner = await services.registerUser({
    name: `Responsable budget Meta ${suffix}`,
    email: `meta-budget-owner-${suffix}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Organisation budget Meta ${suffix}`,
    category: "Services",
  });
  const endpoint = await registerAuthorizedMetaWhatsAppEndpoint(
    db,
    {
      tenantId: tenant.id,
      actorId: owner.id,
      externalAccountId: `3155893132415608${suffix}`,
      phoneNumberId: `879418925277868${suffix}`,
      occurredAt: timestamp,
    },
    "meta-budget-fingerprint-secret-at-least-32-bytes",
  );
  const authorization = await issueWhatsAppMetaTrialAuthorization(db, {
    tenantId: tenant.id,
    actorId: owner.id,
    endpointId: endpoint.endpointId,
    idempotencyKey: `meta-trial-budget-authorization-${suffix}`,
    freeUnitsConfirmed: true,
    expiresAt,
    occurredAt: timestamp,
  });
  const threadId = `thread_meta_budget_${suffix}`;
  const customerParticipantId = `participant_meta_budget_customer_${suffix}`;
  const systemParticipantId = `participant_meta_budget_system_${suffix}`;
  const customerIdentityId = `identity_meta_budget_customer_${suffix}`;
  const systemIdentityId = `identity_meta_budget_system_${suffix}`;
  const messageId = `message_meta_budget_${suffix}`;
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values
       ($1, $2, 'customer', 'Contact essai Meta', $3, $3),
       ($4, $2, 'system', 'TRADIKOM ONE', $3, $3)`,
    [customerParticipantId, tenant.id, timestamp, systemParticipantId],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values
       ($1, $2, $3, 'messaging', 'whatsapp-meta', $4,
        'Contact essai Meta', 'customer', 'active', $5, $5),
       ($6, $2, $7, 'web', 'web-chat', $8,
        'TRADIKOM ONE', 'system', 'active', $5, $5)`,
    [
      customerIdentityId,
      tenant.id,
      customerParticipantId,
      `meta_budget_subject_${suffix}`,
      timestamp,
      systemIdentityId,
      systemParticipantId,
      `meta_budget_system_${suffix}`,
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
  await reserveMetaWhatsAppIdentityBinding(db, {
    id: `binding_meta_budget_${suffix}`,
    tenantId: tenant.id,
    endpointId: endpoint.endpointId,
    channelIdentityId: customerIdentityId,
    createdAt: timestamp,
  });
  await db.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, causation_id, safe_error_code, occurred_at, created_at
     ) values (
       $1, $2, $3, $4, 'outbound', 'result', 'pending',
       'Résultat métier d’essai', 'web-chat', null, $5, $6, null, null, $7, $7
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
  return {
    db,
    owner,
    tenant,
    endpointId: endpoint.endpointId,
    authorizationId: authorization.authorizationId,
    customerIdentityId,
    messageId,
  };
}

async function reserveDelivery(
  setup: Awaited<ReturnType<typeof createSetup>>,
  idempotencyKey: string,
  linkAuthorization = true,
) {
  const deliveryId = id("channel_delivery");
  const reservation = await reserveWhatsAppOutboundDelivery(setup.db, {
    id: deliveryId,
    tenantId: setup.tenant.id,
    endpointId: setup.endpointId,
    messageId: setup.messageId,
    channelIdentityId: setup.customerIdentityId,
    idempotencyKey,
    requestFingerprint: hashToken(idempotencyKey),
    actorId: setup.owner.id,
    occurredAt: timestamp,
    maxAttempts: 3,
    activationAuthorizationId: linkAuthorization
      ? setup.authorizationId
      : undefined,
    provider: "whatsapp_meta",
  });
  expect(reservation.replayed).toBe(false);
  return deliveryId;
}

function budgetInput(
  setup: Awaited<ReturnType<typeof createSetup>>,
  deliveryId: string,
  occurredAt: string,
) {
  return {
    tenantId: setup.tenant.id,
    endpointId: setup.endpointId,
    authorizationId: setup.authorizationId,
    deliveryId,
    occurredAt,
  };
}

async function countConsumptions(
  setup: Awaited<ReturnType<typeof createSetup>>,
) {
  const result = await setup.db.query<{ count: number }>(
    `select count(*)::integer as count
     from channel_provider_activation_consumptions
     where tenant_id = $1 and provider = 'whatsapp_meta'`,
    [setup.tenant.id],
  );
  return result.rows[0]?.count ?? 0;
}
