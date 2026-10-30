import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { hashToken, id } from "../src/lib/security";
import {
  issueWhatsAppTwilioActivationAuthorization,
  registerAuthorizedWhatsAppEndpoint,
  reserveWhatsAppOutboundDelivery,
  reserveWhatsAppTwilioActivationBudget,
  revokeWhatsAppTwilioActivationAuthorization,
  setAuthorizedWhatsAppEndpointStatus,
  type WhatsAppTwilioActivationBudgetError,
} from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const timestamp = "2026-08-08T16:00:00.000Z";
const secondTimestamp = "2026-08-08T16:05:00.000Z";
const expiresAt = "2026-08-08T17:00:00.000Z";
const fingerprintSecret = "budget-fingerprint-secret-at-least-32-bytes";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("budget d'activation WhatsApp/Twilio tenant-aware", () => {
  it("consomme une unité, rejoue sans double consommation et audite sans contenu", async () => {
    const setup = await createSetup(2);
    const deliveryId = await reserveDelivery(setup, "budget-delivery-one");
    const input = budgetInput(setup, deliveryId, timestamp);

    const first = await reserveWhatsAppTwilioActivationBudget(
      setup.db,
      setup.owner.id,
      input,
    );
    const replay = await reserveWhatsAppTwilioActivationBudget(
      setup.db,
      setup.owner.id,
      input,
    );

    expect(first).toMatchObject({
      authorizationId: setup.authorizationId,
      deliveryId,
      usedMessages: 1,
      remainingMessages: 1,
      replayed: false,
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await count(setup, "channel_provider_activation_consumptions")).toBe(1);
    const audits = await setup.db.query<{
      action: string;
      target_id: string;
      safe_metadata: string;
    }>(
      `select action, target_id, safe_metadata from audit_logs
       where tenant_id = $1
         and action = 'channel.provider_activation_budget_consumed'`,
      [setup.tenant.id],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]?.target_id).toBe(first.consumptionId);
    expect(JSON.stringify(audits.rows)).not.toMatch(
      /account|sid|token|phone|number|address|url|body|content|ciphertext|resultat metier/i,
    );
  });

  it("respecte atomiquement les plafonds un et deux", async () => {
    const one = await createSetup(1);
    const oneDelivery = await reserveDelivery(one, "budget-one-a");
    await reserveWhatsAppTwilioActivationBudget(
      one.db,
      one.owner.id,
      budgetInput(one, oneDelivery, timestamp),
    );
    const overflow = await reserveDelivery(one, "budget-one-b");
    await expect(
      reserveWhatsAppTwilioActivationBudget(
        one.db,
        one.owner.id,
        budgetInput(one, overflow, secondTimestamp),
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_budget_exhausted",
    } satisfies Partial<WhatsAppTwilioActivationBudgetError>);

    const two = await createSetup(2);
    const first = await reserveDelivery(two, "budget-two-a");
    const second = await reserveDelivery(two, "budget-two-b");
    await expect(
      reserveWhatsAppTwilioActivationBudget(
        two.db,
        two.owner.id,
        budgetInput(two, first, timestamp),
      ),
    ).resolves.toMatchObject({ usedMessages: 1, remainingMessages: 1 });
    await expect(
      reserveWhatsAppTwilioActivationBudget(
        two.db,
        two.owner.id,
        budgetInput(two, second, secondTimestamp),
      ),
    ).resolves.toMatchObject({ usedMessages: 2, remainingMessages: 0 });
  });

  it("refuse expiration, révocation, autre tenant, endpoint et acteur", async () => {
    const setup = await createSetup(2);
    const deliveryId = await reserveDelivery(setup, "budget-invalid-a");
    await expect(
      reserveWhatsAppTwilioActivationBudget(
        setup.db,
        setup.owner.id,
        budgetInput(setup, deliveryId, expiresAt),
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_budget_invalid",
    } satisfies Partial<WhatsAppTwilioActivationBudgetError>);

    await setAuthorizedWhatsAppEndpointStatus(setup.db, {
      tenantId: setup.tenant.id,
      actorId: setup.owner.id,
      endpointId: setup.endpointId,
      status: "disabled",
      occurredAt: secondTimestamp,
    });
    await expect(
      reserveWhatsAppTwilioActivationBudget(
        setup.db,
        setup.owner.id,
        budgetInput(setup, deliveryId, secondTimestamp),
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_budget_invalid",
    } satisfies Partial<WhatsAppTwilioActivationBudgetError>);
    await setAuthorizedWhatsAppEndpointStatus(setup.db, {
      tenantId: setup.tenant.id,
      actorId: setup.owner.id,
      endpointId: setup.endpointId,
      status: "active",
      occurredAt: secondTimestamp,
    });

    await revokeWhatsAppTwilioActivationAuthorization(setup.db, {
      tenantId: setup.tenant.id,
      actorId: setup.owner.id,
      authorizationId: setup.authorizationId,
      occurredAt: secondTimestamp,
    });
    await expect(
      reserveWhatsAppTwilioActivationBudget(
        setup.db,
        setup.owner.id,
        budgetInput(setup, deliveryId, secondTimestamp),
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_budget_invalid",
    } satisfies Partial<WhatsAppTwilioActivationBudgetError>);

    const other = await createSetup(1);
    const otherDelivery = await reserveDelivery(other, "budget-invalid-b");
    await expect(
      reserveWhatsAppTwilioActivationBudget(setup.db, setup.owner.id, {
        tenantId: setup.tenant.id,
        endpointId: setup.endpointId,
        authorizationId: setup.authorizationId,
        deliveryId: otherDelivery,
        occurredAt: secondTimestamp,
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_budget_invalid",
    } satisfies Partial<WhatsAppTwilioActivationBudgetError>);
    await expect(
      reserveWhatsAppTwilioActivationBudget(other.db, setup.owner.id, {
        ...budgetInput(other, otherDelivery, secondTimestamp),
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_activation_budget_access_denied",
    } satisfies Partial<WhatsAppTwilioActivationBudgetError>);
  });

  it("interdit mutation et relation croisée même hors service", async () => {
    const setup = await createSetup(2);
    const deliveryId = await reserveDelivery(setup, "budget-direct-a");
    const consumed = await reserveWhatsAppTwilioActivationBudget(
      setup.db,
      setup.owner.id,
      budgetInput(setup, deliveryId, timestamp),
    );
    await expect(
      setup.db.query(
        `update channel_provider_activation_consumptions
         set consumed_at = $1 where id = $2`,
        [secondTimestamp, consumed.consumptionId],
      ),
    ).rejects.toThrow(/immutable/i);
  });
});

async function createSetup(maxMessages: 1 | 2) {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const suffix = opened.length;
  const owner = await services.registerUser({
    name: `Propriétaire budget ${suffix}`,
    email: `budget-owner-${suffix}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Organisation budget ${suffix}`,
    category: "Services",
  });
  const endpoint = await registerAuthorizedWhatsAppEndpoint(
    db,
    {
      tenantId: tenant.id,
      actorId: owner.id,
      externalAccountId: `AC${String(suffix).repeat(32).slice(0, 32)}`,
      destinationAddress: `whatsapp:+1500555000${suffix}`,
      occurredAt: timestamp,
    },
    fingerprintSecret,
  );
  const authorization = await issueWhatsAppTwilioActivationAuthorization(db, {
    tenantId: tenant.id,
    actorId: owner.id,
    endpointId: endpoint.endpointId,
    idempotencyKey: `budget-authorization-${suffix}`,
    maxMessages,
    freeUnitsConfirmed: true,
    expiresAt,
    occurredAt: timestamp,
  });
  const threadId = `thread_budget_${suffix}`;
  const customerParticipantId = `participant_budget_customer_${suffix}`;
  const systemParticipantId = `participant_budget_system_${suffix}`;
  const customerIdentityId = `identity_budget_customer_${suffix}`;
  const systemIdentityId = `identity_budget_system_${suffix}`;
  const messageId = `message_budget_${suffix}`;
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values
       ($1, $2, 'customer', 'Contact budget', $3, $3),
       ($4, $2, 'system', 'TRADIKOM ONE', $3, $3)`,
    [customerParticipantId, tenant.id, timestamp, systemParticipantId],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values
       ($1, $2, $3, 'messaging', 'whatsapp-twilio', $4,
        'Contact budget', 'customer', 'active', $5, $5),
       ($6, $2, $7, 'web', 'web-chat', $8,
        'TRADIKOM ONE', 'system', 'active', $5, $5)`,
    [
      customerIdentityId,
      tenant.id,
      customerParticipantId,
      `budget_subject_${suffix}`,
      timestamp,
      systemIdentityId,
      systemParticipantId,
      `budget_system_${suffix}`,
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
       $1, $2, $3, $4, 'outbound', 'result', 'pending',
       'Résultat métier de test', 'web-chat', null, $5, $6, null, null, $7, $7
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

async function count(
  setup: Awaited<ReturnType<typeof createSetup>>,
  table: string,
) {
  const result = await setup.db.query<{ count: number }>(
    `select count(*)::integer as count from ${table}`,
  );
  return result.rows[0]?.count ?? 0;
}
