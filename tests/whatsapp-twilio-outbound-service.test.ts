import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  channelAdapterManifestSchema,
  createWhatsAppTwilioOutboundAdapter,
  createWhatsAppTwilioTransport,
  getPreparedChannelProvider,
  issueWhatsAppTwilioActivationAuthorization,
  processWhatsAppOutboundDeliveryWorker,
  registerAuthorizedWhatsAppEndpoint,
  revokeWhatsAppTwilioActivationAuthorization,
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
        endpointId: setup.endpointId,
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

  it("résout credentials et destination seulement après les gardes et sans fuite publique", async () => {
    const setup = await createSetup();
    const order: string[] = [];
    const secretToken = "credential-only-in-memory";
    const createMessage = vi.fn(async () => {
      order.push("message");
      return { sid: providerMessageSid, status: "queued" };
    });
    const transport = createWhatsAppTwilioTransport({
      state: "mock",
      statusCallbackUrl:
        "https://app.example.test/api/webhooks/twilio/whatsapp/status",
      resolveCredentials: vi.fn(async () => {
        order.push("credentials");
        return { accountSid, authToken: secretToken };
      }),
      resolveDestination: vi.fn(async () => {
        order.push("destination");
        return {
          senderAddress: "whatsapp:+15005550006",
          recipientAddress: destinationAddress,
        };
      }),
      createClient: vi.fn(() => {
        order.push("client");
        return { messages: { create: createMessage } };
      }),
    });
    const adapter = createWhatsAppTwilioOutboundAdapter({
      manifest: mockManifest(),
      transport,
    });

    const result = await sendPreparedWhatsAppOutbound(
      setup.db,
      setup.owner.id,
      deliveryInput(setup, "whatsapp-outbound-ephemeral"),
      {
        adapter,
        evaluatePolicy: () => {
          order.push("policy");
          return { allowed: true };
        },
      },
    );
    const serialized = JSON.stringify(result);

    expect(order).toEqual([
      "policy",
      "credentials",
      "destination",
      "client",
      "message",
    ]);
    expect(serialized).not.toContain(secretToken);
    expect(serialized).not.toContain(destinationAddress);
    expect(serialized).not.toContain(messageText);
    expect(serialized).not.toContain(providerMessageSid);
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
        CHANNEL_PROVIDER_SECRET_ACTIVE_KEY_VERSION: "test-v1",
        CHANNEL_PROVIDER_SECRET_KEY_REFERENCES:
          '[{"version":"test-v1","reference":"test-secret://channel-key/test-v1"}]',
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

  it("consomme le budget ready après la policy et le retrouve au retry worker", async () => {
    const setup = await createSetup();
    const now = new Date(timestamp);
    const authorization = await issueActivationAuthorization(
      setup,
      new Date(now.getTime() + 60_000).toISOString(),
    );
    let policyChecks = 0;
    let transportCalls = 0;
    const evaluatePolicy = vi.fn(async () => {
      const consumptionCount = await countActivationConsumptions(setup.db);
      expect(consumptionCount).toBe(policyChecks === 0 ? 0 : 1);
      policyChecks += 1;
      return { allowed: true as const };
    });
    const sendMessage = vi.fn(async () => {
      expect(await countActivationConsumptions(setup.db)).toBe(1);
      transportCalls += 1;
      if (transportCalls === 1) {
        return {
          status: "failed" as const,
          provider: "whatsapp_twilio" as const,
          errorCode: "temporary_provider_failure" as const,
          classification: "temporary" as const,
          retryable: true,
        };
      }
      return {
        status: "accepted" as const,
        provider: "whatsapp_twilio" as const,
        externalMessageId: providerMessageSid,
        retryable: false,
      };
    });
    const dependencies = {
      adapter: readyAdapter(sendMessage),
      evaluatePolicy,
    };

    const initial = await sendPreparedWhatsAppOutbound(
      setup.db,
      setup.owner.id,
      deliveryInput(setup, "whatsapp-ready-budget-retry"),
      dependencies,
      {
        now,
        baseBackoffMs: 1_000,
        activationAuthorizationId: authorization.authorizationId,
      },
    );
    const resumed = await processWhatsAppOutboundDeliveryWorker(
      setup.db,
      setup.owner.id,
      setup.tenant.id,
      dependencies,
      { now: new Date(now.getTime() + 1_000), baseBackoffMs: 1_000 },
    );

    expect(initial).toMatchObject({
      status: "failed",
      classification: "temporary",
      retryable: true,
    });
    expect(resumed).toMatchObject({ processed: 1, succeeded: 1 });
    expect(evaluatePolicy).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(await countActivationConsumptions(setup.db)).toBe(1);
    expect(await countActivationConsumptionAudits(setup.db)).toBe(1);
  });

  it("refuse un transport ready sans autorisation avant toute I/O", async () => {
    const setup = await createSetup();
    const sendMessage = vi.fn();
    const evaluatePolicy = vi.fn().mockReturnValue({ allowed: true });

    const result = await sendPreparedWhatsAppOutbound(
      setup.db,
      setup.owner.id,
      deliveryInput(setup, "whatsapp-ready-budget-missing"),
      { adapter: readyAdapter(sendMessage), evaluatePolicy },
      { now: new Date(timestamp) },
    );

    expect(result).toMatchObject({
      status: "denied",
      classification: "policy",
      safeErrorCode: "channel_provider_activation_budget_invalid",
      retryable: false,
    });
    expect(evaluatePolicy).toHaveBeenCalledOnce();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(await countActivationConsumptions(setup.db)).toBe(0);
  });

  it.each(["expired", "revoked"] as const)(
    "refuse au retry worker un budget %s sans seconde consommation",
    async (mode) => {
      const setup = await createSetup();
      const now = new Date(timestamp);
      const authorization = await issueActivationAuthorization(
        setup,
        new Date(
          now.getTime() + (mode === "expired" ? 500 : 60_000),
        ).toISOString(),
      );
      const sendMessage = vi.fn().mockResolvedValue({
        status: "failed",
        provider: "whatsapp_twilio",
        errorCode: "temporary_provider_failure",
        classification: "temporary",
        retryable: true,
      });
      const dependencies = {
        adapter: readyAdapter(sendMessage),
        evaluatePolicy: vi.fn().mockReturnValue({ allowed: true }),
      };
      const initial = await sendPreparedWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        deliveryInput(setup, `whatsapp-ready-budget-${mode}`),
        dependencies,
        {
          now,
          baseBackoffMs: 1_000,
          activationAuthorizationId: authorization.authorizationId,
        },
      );
      if (mode === "revoked") {
        await revokeWhatsAppTwilioActivationAuthorization(setup.db, {
          tenantId: setup.tenant.id,
          actorId: setup.owner.id,
          authorizationId: authorization.authorizationId,
          occurredAt: new Date(now.getTime() + 500).toISOString(),
        });
      }

      const resumed = await processWhatsAppOutboundDeliveryWorker(
        setup.db,
        setup.owner.id,
        setup.tenant.id,
        dependencies,
        { now: new Date(now.getTime() + 1_000), baseBackoffMs: 1_000 },
      );
      const delivery = await setup.db.query<{
        status: string;
        safe_error_code: string | null;
      }>(
        `select status, safe_error_code
         from channel_provider_deliveries
         where tenant_id = $1 and id = $2`,
        [setup.tenant.id, initial.deliveryId],
      );

      expect(resumed).toMatchObject({ processed: 1, failed: 1 });
      expect(sendMessage).toHaveBeenCalledOnce();
      expect(delivery.rows).toEqual([
        {
          status: "denied",
          safe_error_code: "channel_provider_activation_budget_invalid",
        },
      ]);
      expect(await countActivationConsumptions(setup.db)).toBe(1);
      expect(await countActivationConsumptionAudits(setup.db)).toBe(1);
    },
  );
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
  return createWhatsAppTwilioOutboundAdapter({
    manifest: mockManifest(),
    transport: {
      sendMessage:
        sendMessage as WhatsAppTwilioOutboundTransport["sendMessage"],
    },
  });
}

function readyAdapter(sendMessage: ReturnType<typeof vi.fn>) {
  const base = getPreparedChannelProvider("whatsapp_twilio", {});
  return createWhatsAppTwilioOutboundAdapter({
    manifest: channelAdapterManifestSchema.parse({
      ...base,
      state: "ready",
      missingEnvironment: [],
      transportEnabled: true,
    }),
    transport: {
      sendMessage:
        sendMessage as WhatsAppTwilioOutboundTransport["sendMessage"],
    },
  });
}

async function issueActivationAuthorization(
  setup: Awaited<ReturnType<typeof createSetup>>,
  expiresAt: string,
) {
  return issueWhatsAppTwilioActivationAuthorization(setup.db, {
    tenantId: setup.tenant.id,
    actorId: setup.owner.id,
    endpointId: setup.endpointId,
    idempotencyKey: "whatsapp-ready-activation-budget",
    maxMessages: 1,
    freeUnitsConfirmed: true,
    expiresAt,
    occurredAt: timestamp,
  });
}

async function countActivationConsumptions(db: TestDb) {
  const result = await db.query<{ count: number }>(
    `select count(*)::integer as count
     from channel_provider_activation_consumptions`,
  );
  return result.rows[0]?.count ?? 0;
}

async function countActivationConsumptionAudits(db: TestDb) {
  const result = await db.query<{ count: number }>(
    `select count(*)::integer as count
     from audit_logs
     where action = 'channel.provider_activation_budget_consumed'`,
  );
  return result.rows[0]?.count ?? 0;
}

function mockManifest() {
  const base = getPreparedChannelProvider("whatsapp_twilio", {});
  return channelAdapterManifestSchema.parse({
    ...base,
    state: "mock",
    missingEnvironment: [],
    transportEnabled: true,
  });
}
