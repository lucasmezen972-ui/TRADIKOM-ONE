import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  channelAdapterManifestSchema,
  createWhatsAppTwilioOutboundAdapter,
  getPreparedChannelProvider,
  registerAuthorizedWhatsAppEndpoint,
  sendPreparedWhatsAppOutbound,
  type WhatsAppTwilioOutboundTransport,
} from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const fingerprintSecret = "test-fingerprint-secret-32-bytes-minimum";
const accountSid = `AC${"a".repeat(32)}`;
const providerMessageSid = `SM${"b".repeat(32)}`;
const destinationAddress = "whatsapp:+596696000000";
const messageText = "Votre résultat métier est prêt.";
const timestamp = "2026-08-08T06:00:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("service sortant WhatsApp/Twilio tenant-aware", () => {
  it("réserve et exécute une seule fois avec un double explicitement mock", async () => {
    const setup = await createSetup();
    const sendMessage = vi.fn().mockResolvedValue({
      status: "accepted",
      provider: "whatsapp_twilio",
      externalMessageId: providerMessageSid,
      retryable: false,
    });
    const evaluatePolicy = vi.fn().mockReturnValue({ allowed: true });
    const adapter = mockAdapter(sendMessage);
    const input = deliveryInput(setup, "whatsapp-outbound-success");

    const first = await sendPreparedWhatsAppOutbound(
      setup.db,
      setup.owner.id,
      input,
      { adapter, evaluatePolicy },
    );
    const replay = await sendPreparedWhatsAppOutbound(
      setup.db,
      setup.owner.id,
      input,
      { adapter, evaluatePolicy },
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
        channelIdentityId: setup.customerIdentityId,
        messageId: setup.messageId,
        text: messageText,
      }),
    );

    const deliveries = await setup.db.query<Record<string, unknown>>(
      "select * from channel_provider_deliveries where tenant_id = $1",
      [setup.tenant.id],
    );
    expect(deliveries.rows).toHaveLength(1);
    expect(deliveries.rows[0]).toMatchObject({
      status: "accepted",
      provider: "whatsapp_twilio",
      external_message_id: providerMessageSid,
    });
    expect(JSON.stringify(deliveries.rows)).not.toContain(messageText);
    expect(JSON.stringify(deliveries.rows)).not.toContain(destinationAddress);
    const message = await setup.db.query<{
      status: string;
      safe_error_code: string | null;
    }>(
      `select status, safe_error_code from conversation_messages
       where tenant_id = $1 and id = $2`,
      [setup.tenant.id, setup.messageId],
    );
    expect(message.rows).toEqual([{ status: "sent", safe_error_code: null }]);

    const audits = await setup.db.query<{
      action: string;
      safe_metadata: string;
    }>(
      `select action, safe_metadata from audit_logs
       where tenant_id = $1 and target_type = 'channel_provider_delivery'
       order by created_at, action`,
      [setup.tenant.id],
    );
    expect(audits.rows.map((row) => row.action).sort()).toEqual([
      "channel.whatsapp_outbound_attempted",
      "channel.whatsapp_outbound_reserved",
      "channel.whatsapp_outbound_succeeded",
    ]);
    const serializedAudit = JSON.stringify(audits.rows);
    expect(serializedAudit).not.toContain(messageText);
    expect(serializedAudit).not.toContain(destinationAddress);
    expect(serializedAudit).not.toContain(providerMessageSid);
  });

  it("refuse la policy avant le transport et conserve une preuve sûre", async () => {
    const setup = await createSetup();
    const sendMessage = vi.fn();

    const result = await sendPreparedWhatsAppOutbound(
      setup.db,
      setup.owner.id,
      deliveryInput(setup, "whatsapp-outbound-policy"),
      {
        adapter: mockAdapter(sendMessage),
        evaluatePolicy: () => ({
          allowed: false,
          code: "approval_required",
        }),
      },
    );

    expect(result).toMatchObject({
      status: "denied",
      classification: "policy",
      safeErrorCode: "policy_denied",
      retryable: false,
    });
    expect(sendMessage).not.toHaveBeenCalled();
    const message = await setup.db.query<{
      status: string;
      safe_error_code: string | null;
    }>(
      `select status, safe_error_code from conversation_messages
       where tenant_id = $1 and id = $2`,
      [setup.tenant.id, setup.messageId],
    );
    expect(message.rows).toEqual([
      { status: "failed", safe_error_code: "policy_denied" },
    ]);
    const audit = await setup.db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action = 'channel.whatsapp_outbound_denied'`,
      [setup.tenant.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.safe_metadata).toContain("approval_required");
    expect(audit.rows[0]?.safe_metadata).not.toContain(messageText);
  });

  it.each([
    ["disabled", {}],
    ["not_configured", { FEATURE_CHANNEL_WHATSAPP: "true" }],
    [
      "awaiting_human_auth",
      {
        FEATURE_CHANNEL_WHATSAPP: "true",
        TWILIO_ACCOUNT_SID: "AC_test",
        TWILIO_AUTH_TOKEN: "token_test",
        TWILIO_WHATSAPP_SENDER: "whatsapp:+15005550006",
        TWILIO_WHATSAPP_WEBHOOK_URL:
          "https://app.example.test/api/webhooks/twilio/whatsapp",
        TWILIO_WHATSAPP_STATUS_CALLBACK_URL:
          "https://app.example.test/api/webhooks/twilio/whatsapp/status",
      },
    ],
  ] as const)("refuse le provider %s avant le client", async (state, environment) => {
    const setup = await createSetup();
    const sendMessage = vi.fn();
    const adapter = createWhatsAppTwilioOutboundAdapter({
      manifest: getPreparedChannelProvider("whatsapp_twilio", environment),
      transport: { sendMessage },
    });

    const result = await sendPreparedWhatsAppOutbound(
      setup.db,
      setup.owner.id,
      deliveryInput(setup, `whatsapp-outbound-${state}`),
      { adapter, evaluatePolicy: () => ({ allowed: true }) },
    );

    expect(result).toMatchObject({
      status: "denied",
      classification: "not_configured",
      retryable: false,
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("refuse les rôles insuffisants et les accès inter-tenant", async () => {
    const setup = await createSetup();
    const readOnly = await setup.services.registerUser({
      name: "Lecture seule WhatsApp",
      email: "whatsapp-read-only@example.test",
      password: "Password!1",
    });
    await setup.db.query(
      `insert into memberships (tenant_id, user_id, role, created_at)
       values ($1, $2, 'read-only', $3)`,
      [setup.tenant.id, readOnly.id, timestamp],
    );
    const outsider = await setup.services.registerUser({
      name: "Personne externe WhatsApp",
      email: "whatsapp-outsider@example.test",
      password: "Password!1",
    });
    await setup.services.createTenant(outsider.id, {
      name: "Autre organisation WhatsApp",
      category: "Services",
    });
    const sendMessage = vi.fn();
    const dependencies = {
      adapter: mockAdapter(sendMessage),
      evaluatePolicy: () => ({ allowed: true as const }),
    };

    await expect(
      sendPreparedWhatsAppOutbound(
        setup.db,
        readOnly.id,
        deliveryInput(setup, "whatsapp-outbound-read-only"),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "tenant_access_denied" });
    await expect(
      sendPreparedWhatsAppOutbound(
        setup.db,
        outsider.id,
        deliveryInput(setup, "whatsapp-outbound-outsider"),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "tenant_access_denied" });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("refuse la réutilisation d'une clé pour un autre message", async () => {
    const setup = await createSetup();
    const secondMessageId = "message_whatsapp_outbound_second";
    await seedOutboundMessage(
      setup.db,
      setup.tenant.id,
      setup.threadId,
      setup.systemIdentityId,
      secondMessageId,
      "Autre résultat métier.",
    );
    const sendMessage = vi.fn().mockResolvedValue({
      status: "accepted",
      provider: "whatsapp_twilio",
      externalMessageId: providerMessageSid,
      retryable: false,
    });
    const dependencies = {
      adapter: mockAdapter(sendMessage),
      evaluatePolicy: () => ({ allowed: true as const }),
    };
    const key = "whatsapp-outbound-conflict";

    await sendPreparedWhatsAppOutbound(
      setup.db,
      setup.owner.id,
      deliveryInput(setup, key),
      dependencies,
    );
    await expect(
      sendPreparedWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        { ...deliveryInput(setup, key), messageId: secondMessageId },
        dependencies,
      ),
    ).rejects.toMatchObject({
      code: "whatsapp_outbound_idempotency_conflict",
    });
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: "Propriétaire WhatsApp outbound",
    email: `whatsapp-owner-${opened.length}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Organisation WhatsApp outbound ${opened.length}`,
    category: "Services",
  });
  const endpoint = await registerAuthorizedWhatsAppEndpoint(
    db,
    {
      tenantId: tenant.id,
      actorId: owner.id,
      externalAccountId: accountSid,
      destinationAddress,
    },
    fingerprintSecret,
  );

  const threadId = "thread_whatsapp_outbound";
  const customerParticipantId = "participant_whatsapp_customer";
  const customerIdentityId = "identity_whatsapp_customer";
  const systemParticipantId = "participant_whatsapp_system";
  const systemIdentityId = "identity_whatsapp_system";
  const messageId = "message_whatsapp_outbound";
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
       ($1, $2, $3, 'messaging', 'whatsapp-twilio',
        'whatsapp_subject_opaque', 'Contact WhatsApp', 'customer', 'active', $4, $4),
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
  const base = getPreparedChannelProvider("whatsapp_twilio", {});
  const manifest = channelAdapterManifestSchema.parse({
    ...base,
    state: "mock",
    missingEnvironment: [],
    transportEnabled: true,
  });
  return createWhatsAppTwilioOutboundAdapter({
    manifest,
    transport: {
      sendMessage:
        sendMessage as WhatsAppTwilioOutboundTransport["sendMessage"],
    },
  });
}
