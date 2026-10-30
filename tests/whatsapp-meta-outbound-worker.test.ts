import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { hashToken, id } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import {
  channelAdapterManifestSchema,
  claimWhatsAppOutboundDeliveryAttempt,
  createWhatsAppMetaOutboundAdapter,
  getPreparedChannelProvider,
  issueWhatsAppMetaTrialAuthorization,
  processMetaWhatsAppOutboundDeliveryWorker,
  registerAuthorizedMetaWhatsAppEndpoint,
  reserveMetaWhatsAppIdentityBinding,
  reserveWhatsAppMetaTrialBudget,
  reserveWhatsAppOutboundDelivery,
  sendPreparedMetaWhatsAppOutbound,
  setAuthorizedMetaWhatsAppEndpointStatus,
  WhatsAppMetaTransportError,
  type WhatsAppMetaOutboundPolicyEvaluator,
  type WhatsAppMetaOutboundTransport,
} from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const fingerprintSecret = "test-meta-worker-fingerprint-secret-32-bytes";
const wabaId = "123456789";
const phoneNumberId = "987654321";
const providerMessageId = `wamid.${"b".repeat(32)}`;
const messageText = "Votre résultat métier durable est prêt.";
const timestamp = "2026-08-19T16:30:00.000Z";
const start = new Date(timestamp);

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("worker durable WhatsApp Meta", () => {
  it(
    "reprend une réservation interrompue et ne rejoue jamais le succès",
    async () => {
      const setup = await createSetup();
      const authorization = await issueWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenant.id,
        actorId: setup.owner.id,
        endpointId: setup.endpointId,
        idempotencyKey: "meta-worker-interrupted-authorization",
        freeUnitsConfirmed: true,
        expiresAt: new Date(start.getTime() + 60_000).toISOString(),
        occurredAt: start.toISOString(),
      });
      const deliveryId = await seedReservedDelivery(
        setup,
        "meta-worker-reserved",
        authorization.authorizationId,
      );
      const sendMessage = vi.fn().mockResolvedValue(acceptedResult());
      const dependencies = dependenciesFor(
        sendMessage,
        () => ({ allowed: true }),
        "ready",
      );

      const first = await processMetaWhatsAppOutboundDeliveryWorker(
        setup.db,
        setup.owner.id,
        setup.tenant.id,
        dependencies,
        { now: start },
      );
      const second = await processMetaWhatsAppOutboundDeliveryWorker(
        setup.db,
        setup.owner.id,
        setup.tenant.id,
        dependencies,
        { now: new Date(start.getTime() + 60_000) },
      );

      expect(first).toEqual({
        selected: 1,
        processed: 1,
        succeeded: 1,
        retried: 0,
        failed: 0,
        skipped: 0,
      });
      expect(second.selected).toBe(0);
      expect(sendMessage).toHaveBeenCalledOnce();
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          endpointId: setup.endpointId,
          idempotencyKey: "meta-worker-reserved",
          text: messageText,
        }),
      );
      const delivery = await readDelivery(setup.db, deliveryId);
      expect(delivery).toMatchObject({
        provider: "whatsapp_meta",
        status: "accepted",
        attempts: 1,
        max_attempts: 3,
        lease_id: null,
        lease_expires_at: null,
        activation_authorization_id: authorization.authorizationId,
      });
      expect(await countActivationConsumptions(setup.db)).toBe(1);
    },
    25_000,
  );

  it(
    "ferme une reprise après consommation sans jamais réémettre le transport ready",
    async () => {
      const setup = await createSetup();
      const authorization = await issueWhatsAppMetaTrialAuthorization(setup.db, {
        tenantId: setup.tenant.id,
        actorId: setup.owner.id,
        endpointId: setup.endpointId,
        idempotencyKey: "meta-worker-consumed-before-crash-authorization",
        freeUnitsConfirmed: true,
        expiresAt: new Date(start.getTime() + 60_000).toISOString(),
        occurredAt: start.toISOString(),
      });
      const deliveryId = await seedReservedDelivery(
        setup,
        "meta-worker-consumed-before-crash",
        authorization.authorizationId,
      );
      const leaseExpiresAt = new Date(start.getTime() + 500);
      const claimed = await claimWhatsAppOutboundDeliveryAttempt(setup.db, {
        tenantId: setup.tenant.id,
        deliveryId,
        leaseId: "meta-worker-crashed-lease",
        attemptedAt: start.toISOString(),
        leaseExpiresAt: leaseExpiresAt.toISOString(),
        provider: "whatsapp_meta",
      });
      expect(claimed).not.toBeNull();
      const consumed = await reserveWhatsAppMetaTrialBudget(
        setup.db,
        setup.owner.id,
        {
          tenantId: setup.tenant.id,
          endpointId: setup.endpointId,
          authorizationId: authorization.authorizationId,
          deliveryId,
          occurredAt: start.toISOString(),
        },
      );
      expect(consumed.replayed).toBe(false);

      const transport = vi.fn().mockResolvedValue(acceptedResult());
      const evaluatePolicy = vi.fn().mockReturnValue({ allowed: true });
      const dependencies = dependenciesFor(
        transport,
        evaluatePolicy,
        "ready",
      );
      // Simule l'acceptation externe suivie d'un crash avant la finalisation DB.
      const externalResult = await dependencies.adapter.sendMessage({
        tenantId: setup.tenant.id,
        endpointId: setup.endpointId,
        channelIdentityId: setup.customerIdentityId,
        messageId: setup.messageId,
        idempotencyKey: "meta-worker-consumed-before-crash",
        text: messageText,
      });
      expect(externalResult.status).toBe("accepted");
      const summary = await processMetaWhatsAppOutboundDeliveryWorker(
        setup.db,
        setup.owner.id,
        setup.tenant.id,
        dependencies,
        { now: leaseExpiresAt },
      );

      expect(summary).toEqual({
        selected: 1,
        processed: 1,
        succeeded: 0,
        retried: 0,
        failed: 1,
        skipped: 0,
      });
      expect(evaluatePolicy).toHaveBeenCalledOnce();
      expect(transport).toHaveBeenCalledOnce();
      expect(await readDelivery(setup.db, deliveryId)).toMatchObject({
        status: "failed",
        failure_classification: "permanent",
        safe_error_code:
          "channel_provider_activation_transport_outcome_uncertain",
        retryable: false,
        attempts: 2,
        lease_id: null,
        lease_expires_at: null,
      });
      expect(await readMessageStatus(setup)).toEqual({
        status: "failed",
        safe_error_code:
          "channel_provider_activation_transport_outcome_uncertain",
      });
      expect(await countActivationConsumptions(setup.db)).toBe(1);
    },
    25_000,
  );

  it(
    "reprend un échec temporaire au backoff avec la même idempotence",
    async () => {
      const setup = await createSetup();
      const effects = new Set<string>();
      const sendMessage = vi.fn().mockImplementation(async (request) => {
        if (!effects.has(request.idempotencyKey)) {
          effects.add(request.idempotencyKey);
          throw new WhatsAppMetaTransportError("temporary");
        }
        return acceptedResult();
      });
      const evaluatePolicy = vi.fn().mockReturnValue({ allowed: true });
      const dependencies = dependenciesFor(sendMessage, evaluatePolicy);
      const key = "meta-worker-temporary-resume";

      const initial = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        deliveryInput(setup, key),
        dependencies,
        { now: start, baseBackoffMs: 1_000 },
      );
      const tooSoon = await processMetaWhatsAppOutboundDeliveryWorker(
        setup.db,
        setup.owner.id,
        setup.tenant.id,
        dependencies,
        { now: new Date(start.getTime() + 999), baseBackoffMs: 1_000 },
      );
      const resumed = await processMetaWhatsAppOutboundDeliveryWorker(
        setup.db,
        setup.owner.id,
        setup.tenant.id,
        dependencies,
        { now: new Date(start.getTime() + 1_000), baseBackoffMs: 1_000 },
      );

      expect(initial).toMatchObject({
        status: "failed",
        classification: "temporary",
        retryable: true,
        attempts: 1,
      });
      expect(tooSoon.selected).toBe(0);
      expect(resumed).toMatchObject({ processed: 1, succeeded: 1 });
      expect(sendMessage).toHaveBeenCalledTimes(2);
      expect(
        sendMessage.mock.calls.map(([request]) => request.idempotencyKey),
      ).toEqual([key, key]);
      expect(evaluatePolicy).toHaveBeenCalledTimes(2);
      expect(await readMessageStatus(setup)).toEqual({
        status: "sent",
        safe_error_code: null,
      });
    },
    25_000,
  );

  it(
    "arrête sûrement une livraison lorsque l'endpoint est désactivé avant la reprise",
    async () => {
      const setup = await createSetup();
      const deliveryId = await seedReservedDelivery(setup, "meta-worker-disabled");
      await setAuthorizedMetaWhatsAppEndpointStatus(setup.db, {
        tenantId: setup.tenant.id,
        actorId: setup.owner.id,
        endpointId: setup.endpointId,
        status: "disabled",
      });
      const sendMessage = vi.fn();

      const summary = await processMetaWhatsAppOutboundDeliveryWorker(
        setup.db,
        setup.owner.id,
        setup.tenant.id,
        dependenciesFor(sendMessage),
        { now: start },
      );

      expect(summary).toMatchObject({ selected: 1, processed: 1, failed: 1 });
      expect(sendMessage).not.toHaveBeenCalled();
      expect(await readDelivery(setup.db, deliveryId)).toMatchObject({
        status: "failed",
        safe_error_code: "channel_endpoint_inactive",
      });
      expect(await readMessageStatus(setup)).toEqual({
        status: "failed",
        safe_error_code: "channel_endpoint_inactive",
      });
    },
    25_000,
  );
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: "Propriétaire WhatsApp Meta worker",
    email: `meta-worker-owner-${opened.length}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Organisation WhatsApp Meta worker ${opened.length}`,
    category: "Services",
  });
  const endpoint = await registerAuthorizedMetaWhatsAppEndpoint(
    db,
    {
      tenantId: tenant.id,
      actorId: owner.id,
      externalAccountId: wabaId,
      phoneNumberId,
    },
    fingerprintSecret,
  );
  const threadId = "thread_whatsapp_meta_worker";
  const customerParticipantId = "participant_whatsapp_meta_worker_customer";
  const customerIdentityId = "identity_whatsapp_meta_worker_customer";
  const systemParticipantId = "participant_whatsapp_meta_worker_system";
  const systemIdentityId = "identity_whatsapp_meta_worker_system";
  const messageId = "message_whatsapp_meta_worker";
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values
       ($1, $2, 'customer', 'Contact WhatsApp', $3, $3),
       ($4, $2, 'system', 'TRADIKOM ONE', $3, $3)`,
    [customerParticipantId, tenant.id, timestamp, systemParticipantId],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values
       ($1, $2, $3, 'messaging', 'whatsapp-meta',
        'meta_subject_opaque', 'Contact WhatsApp', 'customer', 'active', $4, $4),
       ($5, $2, $6, 'web', 'web-chat',
        'system_subject_opaque', 'TRADIKOM ONE', 'system', 'active', $4, $4)`,
    [
      customerIdentityId,
      tenant.id,
      customerParticipantId,
      timestamp,
      systemIdentityId,
      systemParticipantId,
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
    id: "binding_whatsapp_meta_worker_customer",
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
       $1, $2, $3, $4, 'outbound', 'result', 'pending', $5, 'web-chat', null,
       $6, $7, null, null, $8, $8
     )`,
    [
      messageId,
      tenant.id,
      threadId,
      systemIdentityId,
      messageText,
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
    customerIdentityId,
    messageId,
  };
}

async function seedReservedDelivery(
  setup: Awaited<ReturnType<typeof createSetup>>,
  idempotencyKey: string,
  activationAuthorizationId?: string,
) {
  const deliveryId = id("channel_delivery");
  const requestFingerprint = hashToken(
    JSON.stringify([
      "whatsapp_meta",
      setup.endpointId,
      setup.messageId,
      setup.customerIdentityId,
      activationAuthorizationId ?? null,
    ]),
  );
  const reservation = await reserveWhatsAppOutboundDelivery(setup.db, {
    id: deliveryId,
    tenantId: setup.tenant.id,
    endpointId: setup.endpointId,
    messageId: setup.messageId,
    channelIdentityId: setup.customerIdentityId,
    idempotencyKey,
    requestFingerprint,
    actorId: setup.owner.id,
    occurredAt: start.toISOString(),
    maxAttempts: 3,
    activationAuthorizationId,
    provider: "whatsapp_meta",
  });
  expect(reservation.replayed).toBe(false);
  return deliveryId;
}

function deliveryInput(
  setup: Awaited<ReturnType<typeof createSetup>>,
  idempotencyKey: string,
) {
  return {
    tenantId: setup.tenant.id,
    endpointId: setup.endpointId,
    messageId: setup.messageId,
    channelIdentityId: setup.customerIdentityId,
    idempotencyKey,
  };
}

function dependenciesFor(
  sendMessage: ReturnType<typeof vi.fn>,
  evaluatePolicy: WhatsAppMetaOutboundPolicyEvaluator = () => ({ allowed: true }),
  state: "mock" | "ready" = "mock",
) {
  const base = getPreparedChannelProvider("whatsapp_meta", {});
  const manifest = channelAdapterManifestSchema.parse({
    ...base,
    state,
    missingEnvironment: [],
    transportEnabled: true,
  });
  return {
    adapter: createWhatsAppMetaOutboundAdapter({
      manifest,
      transport: {
        kind: state === "mock" ? "mock" : "http",
        sendMessage:
          sendMessage as WhatsAppMetaOutboundTransport["sendMessage"],
      },
    }),
    evaluatePolicy,
  };
}

async function countActivationConsumptions(db: TestDb) {
  const result = await db.query<{ count: number }>(
    `select count(*)::integer as count
     from channel_provider_activation_consumptions
     where provider = 'whatsapp_meta'`,
  );
  return result.rows[0]?.count ?? 0;
}

function acceptedResult() {
  return {
    status: "accepted" as const,
    provider: "whatsapp_meta" as const,
    externalMessageId: providerMessageId,
    retryable: false,
  };
}

async function readDelivery(db: TestDb, deliveryId: string) {
  const result = await db.query<Record<string, unknown>>(
    "select * from channel_provider_deliveries where id = $1",
    [deliveryId],
  );
  return result.rows[0] as Record<string, unknown> & { attempts: number };
}

async function readMessageStatus(
  setup: Awaited<ReturnType<typeof createSetup>>,
) {
  const result = await setup.db.query<{
    status: string;
    safe_error_code: string | null;
  }>(
    `select status, safe_error_code from conversation_messages
     where tenant_id = $1 and id = $2`,
    [setup.tenant.id, setup.messageId],
  );
  return result.rows[0];
}
