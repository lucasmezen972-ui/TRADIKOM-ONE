import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  channelAdapterManifestSchema,
  createWhatsAppMetaOutboundAdapter,
  getPreparedChannelProvider,
  registerAuthorizedMetaWhatsAppEndpoint,
  reserveMetaWhatsAppIdentityBinding,
  sendPreparedMetaWhatsAppOutbound,
  type WhatsAppMetaOutboundTransport,
} from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const fingerprintSecret = "test-meta-outbound-fingerprint-secret-32-bytes";
const wabaId = "123456789";
const phoneNumberId = "987654321";
const providerMessageId = `wamid.${"a".repeat(32)}`;
const messageText = "Votre résultat métier est prêt.";
const timestamp = "2026-08-19T16:20:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("service sortant WhatsApp Meta tenant-aware", () => {
  it(
    "réserve et exécute une seule fois avec un double mock, sans PII dans l'audit",
    async () => {
      const setup = await createSetup();
      const sendMessage = vi.fn().mockResolvedValue(acceptedResult());
      const evaluatePolicy = vi.fn().mockReturnValue({ allowed: true });
      const input = deliveryInput(setup, "whatsapp-meta-outbound-success");

      const first = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        input,
        { adapter: mockAdapter(sendMessage), evaluatePolicy },
        { now: new Date(timestamp) },
      );
      const replay = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        input,
        { adapter: mockAdapter(sendMessage), evaluatePolicy },
        { now: new Date(timestamp) },
      );

      expect(first).toMatchObject({
        status: "accepted",
        classification: null,
        idempotentReplay: false,
      });
      expect(replay).toEqual({ ...first, idempotentReplay: true });
      expect(sendMessage).toHaveBeenCalledOnce();
      expect(evaluatePolicy).toHaveBeenCalledOnce();
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: setup.tenant.id,
          endpointId: setup.endpointId,
          channelIdentityId: setup.customerIdentityId,
          messageId: setup.messageId,
          text: messageText,
        }),
      );

      const delivery = await setup.db.query<Record<string, unknown>>(
        `select * from channel_provider_deliveries
         where tenant_id = $1 and id = $2`,
        [setup.tenant.id, first.deliveryId],
      );
      expect(delivery.rows).toHaveLength(1);
      expect(delivery.rows[0]).toMatchObject({
        provider: "whatsapp_meta",
        status: "accepted",
        external_message_id: providerMessageId,
      });
      expect(JSON.stringify(delivery.rows)).not.toContain(messageText);
      expect(JSON.stringify(delivery.rows)).not.toContain(phoneNumberId);

      await expectSafeAudits(setup);
      expect(await readMessageStatus(setup)).toEqual({
        status: "sent",
        safe_error_code: null,
      });
    },
    25_000,
  );

  it(
    "refuse la policy avant le transport et conserve une preuve sûre",
    async () => {
      const setup = await createSetup();
      const sendMessage = vi.fn();

      const result = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        deliveryInput(setup, "whatsapp-meta-outbound-policy"),
        {
          adapter: mockAdapter(sendMessage),
          evaluatePolicy: () => ({
            allowed: false,
            code: "approval_required",
          }),
        },
        { now: new Date(timestamp) },
      );

      expect(result).toMatchObject({
        status: "denied",
        classification: "policy",
        safeErrorCode: "policy_denied",
        retryable: false,
      });
      expect(sendMessage).not.toHaveBeenCalled();
      expect(await readMessageStatus(setup)).toEqual({
        status: "failed",
        safe_error_code: "policy_denied",
      });
      await expectSafeAudits(setup);
    },
    25_000,
  );

  it.each([
    ["disabled", {}],
    ["not_configured", { FEATURE_CHANNEL_WHATSAPP_META: "true" }],
  ] as const)(
    "refuse le provider %s avant le transport",
    async (state, environment) => {
      const setup = await createSetup();
      const sendMessage = vi.fn();
      const adapter = createWhatsAppMetaOutboundAdapter({
        manifest: getPreparedChannelProvider("whatsapp_meta", environment),
        transport: { sendMessage },
      });

      const result = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        deliveryInput(setup, `whatsapp-meta-outbound-${state}`),
        { adapter, evaluatePolicy: () => ({ allowed: true }) },
        { now: new Date(timestamp) },
      );

      expect(result).toMatchObject({
        status: "denied",
        classification: "not_configured",
        retryable: false,
      });
      expect(sendMessage).not.toHaveBeenCalled();
      await expectSafeAudits(setup);
    },
    25_000,
  );

  it(
    "refuse une clé d'idempotence réutilisée pour un autre message",
    async () => {
      const setup = await createSetup();
      const secondMessageId = "message_whatsapp_meta_outbound_second";
      await seedOutboundMessage(
        setup.db,
        setup.tenant.id,
        setup.threadId,
        setup.systemIdentityId,
        secondMessageId,
        "Autre résultat métier.",
      );
      const sendMessage = vi.fn().mockResolvedValue(acceptedResult());
      const dependencies = {
        adapter: mockAdapter(sendMessage),
        evaluatePolicy: () => ({ allowed: true as const }),
      };
      const key = "whatsapp-meta-outbound-conflict";

      await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        deliveryInput(setup, key),
        dependencies,
        { now: new Date(timestamp) },
      );
      await expect(
        sendPreparedMetaWhatsAppOutbound(
          setup.db,
          setup.owner.id,
          { ...deliveryInput(setup, key), messageId: secondMessageId },
          dependencies,
          { now: new Date(timestamp) },
        ),
      ).rejects.toMatchObject({
        code: "whatsapp_meta_outbound_idempotency_conflict",
      });
      expect(sendMessage).toHaveBeenCalledOnce();
    },
    25_000,
  );

  it(
    "refuse les rôles insuffisants et l'accès inter-tenant avant la réservation",
    async () => {
      const setup = await createSetup();
      const readOnly = await setup.services.registerUser({
        name: "Lecture seule Meta",
        email: `meta-read-only-${opened.length}@example.test`,
        password: "Password!1",
      });
      await setup.db.query(
        `insert into memberships (tenant_id, user_id, role, created_at)
         values ($1, $2, 'read-only', $3)`,
        [setup.tenant.id, readOnly.id, timestamp],
      );
      const outsider = await setup.services.registerUser({
        name: "Personne externe Meta",
        email: `meta-outsider-${opened.length}@example.test`,
        password: "Password!1",
      });
      await setup.services.createTenant(outsider.id, {
        name: "Autre organisation Meta",
        category: "Services",
      });
      const sendMessage = vi.fn();
      const dependencies = {
        adapter: mockAdapter(sendMessage),
        evaluatePolicy: () => ({ allowed: true as const }),
      };

      await expect(
        sendPreparedMetaWhatsAppOutbound(
          setup.db,
          readOnly.id,
          deliveryInput(setup, "whatsapp-meta-read-only"),
          dependencies,
          { now: new Date(timestamp) },
        ),
      ).rejects.toMatchObject({ code: "tenant_access_denied" });
      await expect(
        sendPreparedMetaWhatsAppOutbound(
          setup.db,
          outsider.id,
          deliveryInput(setup, "whatsapp-meta-outsider"),
          dependencies,
          { now: new Date(timestamp) },
        ),
      ).rejects.toMatchObject({ code: "tenant_access_denied" });
      expect(sendMessage).not.toHaveBeenCalled();
      const deliveries = await setup.db.query<{ count: number }>(
        `select count(*)::integer as count
         from channel_provider_deliveries where tenant_id = $1`,
        [setup.tenant.id],
      );
      expect(deliveries.rows[0]?.count).toBe(0);
    },
    25_000,
  );

  it(
    "refuse d'envoyer un contact d'un endpoint Meta via un autre endpoint du tenant",
    async () => {
      const setup = await createSetup();
      const secondEndpoint = await registerAuthorizedMetaWhatsAppEndpoint(
        setup.db,
        {
          tenantId: setup.tenant.id,
          actorId: setup.owner.id,
          externalAccountId: "222333444",
          phoneNumberId: "555666777",
        },
        fingerprintSecret,
      );
      const sendMessage = vi.fn();

      await expect(
        sendPreparedMetaWhatsAppOutbound(
          setup.db,
          setup.owner.id,
          {
            ...deliveryInput(setup, "whatsapp-meta-other-endpoint"),
            endpointId: secondEndpoint.endpointId,
          },
          {
            adapter: mockAdapter(sendMessage),
            evaluatePolicy: () => ({ allowed: true }),
          },
          { now: new Date(timestamp) },
        ),
      ).rejects.toMatchObject({
        code: "whatsapp_meta_outbound_context_not_found",
      });
      expect(sendMessage).not.toHaveBeenCalled();
      const deliveries = await setup.db.query<{ count: number }>(
        `select count(*)::integer as count
         from channel_provider_deliveries where tenant_id = $1`,
        [setup.tenant.id],
      );
      expect(deliveries.rows[0]?.count).toBe(0);
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
    name: "Propriétaire WhatsApp Meta",
    email: `meta-owner-${opened.length}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Organisation WhatsApp Meta ${opened.length}`,
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

  const threadId = "thread_whatsapp_meta_outbound";
  const customerParticipantId = "participant_whatsapp_meta_customer";
  const customerIdentityId = "identity_whatsapp_meta_customer";
  const systemParticipantId = "participant_whatsapp_meta_system";
  const systemIdentityId = "identity_whatsapp_meta_system";
  const messageId = "message_whatsapp_meta_outbound";
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
    id: "binding_whatsapp_meta_customer",
    tenantId: tenant.id,
    endpointId: endpoint.endpointId,
    channelIdentityId: customerIdentityId,
    createdAt: timestamp,
  });
  await seedOutboundMessage(
    db,
    tenant.id,
    threadId,
    systemIdentityId,
    messageId,
    messageText,
  );

  return {
    db,
    services,
    owner,
    tenant,
    endpointId: endpoint.endpointId,
    threadId,
    customerIdentityId,
    systemIdentityId,
    messageId,
  };
}

async function seedOutboundMessage(
  db: TestDb,
  tenantId: string,
  threadId: string,
  systemIdentityId: string,
  messageId: string,
  text: string,
) {
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
      tenantId,
      threadId,
      systemIdentityId,
      text,
      `canonical:${messageId}`,
      `correlation:${messageId}`,
      timestamp,
    ],
  );
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

function mockAdapter(sendMessage: ReturnType<typeof vi.fn>) {
  const base = getPreparedChannelProvider("whatsapp_meta", {});
  return createWhatsAppMetaOutboundAdapter({
    manifest: channelAdapterManifestSchema.parse({
      ...base,
      state: "mock",
      missingEnvironment: [],
      transportEnabled: true,
    }),
    transport: {
      sendMessage:
        sendMessage as WhatsAppMetaOutboundTransport["sendMessage"],
    },
  });
}

function acceptedResult() {
  return {
    status: "accepted" as const,
    provider: "whatsapp_meta" as const,
    externalMessageId: providerMessageId,
    retryable: false,
  };
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

async function expectSafeAudits(
  setup: Awaited<ReturnType<typeof createSetup>>,
) {
  const audits = await setup.db.query<{ action: string; safe_metadata: string }>(
    `select action, safe_metadata from audit_logs
     where tenant_id = $1 and target_type = 'channel_provider_delivery'
     order by action`,
    [setup.tenant.id],
  );
  expect(audits.rows.length).toBeGreaterThan(0);
  const serialized = JSON.stringify(audits.rows);
  expect(serialized).not.toContain(messageText);
  expect(serialized).not.toContain(phoneNumberId);
  expect(serialized).not.toContain(wabaId);
  expect(serialized).not.toContain(providerMessageId);
}
