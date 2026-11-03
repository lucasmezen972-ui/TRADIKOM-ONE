import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  channelAdapterManifestSchema,
  createWhatsAppMetaOutboundAdapter,
  createWhatsAppMetaTransport,
  getPreparedChannelProvider,
  issueWhatsAppMetaTrialAuthorization,
  processMetaWhatsAppOutboundDeliveryWorker,
  registerAuthorizedMetaWhatsAppEndpoint,
  reserveMetaWhatsAppIdentityBinding,
  revokeWhatsAppMetaTrialAuthorization,
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
  vi.restoreAllMocks();
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
        transport: { kind: "mock", sendMessage },
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
    "lie durablement la clé d’idempotence à l’autorisation ready initiale",
    async () => {
      const setup = await createSetup();
      const expiresAt = new Date(
        new Date(timestamp).getTime() + 60_000,
      ).toISOString();
      const firstAuthorization = await issueWhatsAppMetaTrialAuthorization(
        setup.db,
        {
          tenantId: setup.tenant.id,
          actorId: setup.owner.id,
          endpointId: setup.endpointId,
          idempotencyKey: "meta-outbound-binding-authorization-a",
          freeUnitsConfirmed: true,
          expiresAt,
          occurredAt: timestamp,
        },
      );
      const secondAuthorization = await issueWhatsAppMetaTrialAuthorization(
        setup.db,
        {
          tenantId: setup.tenant.id,
          actorId: setup.owner.id,
          endpointId: setup.endpointId,
          idempotencyKey: "meta-outbound-binding-authorization-b",
          freeUnitsConfirmed: true,
          expiresAt,
          occurredAt: timestamp,
        },
      );
      const sendMessage = vi.fn();
      const dependencies = {
        adapter: readyAdapter(sendMessage),
        evaluatePolicy: () => ({
          allowed: false as const,
          code: "approval_required",
        }),
      };
      const key = "whatsapp-meta-ready-authorization-binding";

      await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        deliveryInput(setup, key),
        dependencies,
        {
          now: new Date(timestamp),
          activationAuthorizationId: `  ${firstAuthorization.authorizationId}  `,
        },
      );
      await expect(
        sendPreparedMetaWhatsAppOutbound(
          setup.db,
          setup.owner.id,
          deliveryInput(setup, key),
          dependencies,
          {
            now: new Date(timestamp),
            activationAuthorizationId: secondAuthorization.authorizationId,
          },
        ),
      ).rejects.toMatchObject({
        code: "whatsapp_meta_outbound_idempotency_conflict",
      });
      const deliveries = await setup.db.query<{
        activation_authorization_id: string | null;
      }>(
        `select activation_authorization_id
         from channel_provider_deliveries
         where tenant_id = $1 and provider = 'whatsapp_meta'
           and idempotency_key = $2`,
        [setup.tenant.id, key],
      );
      expect(deliveries.rows).toEqual([
        {
          activation_authorization_id: firstAuthorization.authorizationId,
        },
      ]);
      expect(sendMessage).not.toHaveBeenCalled();

      const disabledReplay = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        deliveryInput(setup, key),
        {
          adapter: createWhatsAppMetaOutboundAdapter({
            manifest: getPreparedChannelProvider("whatsapp_meta", {}),
          }),
          evaluatePolicy: () => ({ allowed: true }),
        },
        { now: new Date(timestamp) },
      );
      expect(disabledReplay).toMatchObject({
        status: "denied",
        idempotentReplay: true,
      });
    },
    25_000,
  );

  it(
    "rejoue un succès legacy à quatre champs sans transport ni consommation",
    async () => {
      const setup = await createSetup();
      const key = "whatsapp-meta-legacy-success-replay";
      const legacySend = vi.fn().mockResolvedValue(acceptedResult());
      const legacy = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        deliveryInput(setup, key),
        {
          adapter: mockAdapter(legacySend),
          evaluatePolicy: () => ({ allowed: true }),
        },
        { now: new Date(timestamp) },
      );
      const authorization = await issueActivationAuthorization(
        setup,
        new Date(new Date(timestamp).getTime() + 60_000).toISOString(),
      );
      const readySend = vi.fn();

      const replay = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        deliveryInput(setup, key),
        {
          adapter: readyAdapter(readySend),
          evaluatePolicy: () => ({ allowed: true }),
        },
        {
          now: new Date(timestamp),
          activationAuthorizationId: authorization.authorizationId,
        },
      );

      expect(replay).toEqual({ ...legacy, idempotentReplay: true });
      expect(legacySend).toHaveBeenCalledOnce();
      expect(readySend).not.toHaveBeenCalled();
      expect(await countActivationConsumptions(setup.db)).toBe(0);
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

  it(
    "consomme une seule autorisation ready et ferme le retry sans second transport",
    async () => {
      const setup = await createSetup();
      const now = new Date(timestamp);
      const authorization = await issueActivationAuthorization(
        setup,
        new Date(now.getTime() + 60_000).toISOString(),
      );
      const evaluatePolicy = vi.fn(async () => {
        expect(await countActivationConsumptions(setup.db)).toBe(
          sendMessage.mock.calls.length === 0 ? 0 : 1,
        );
        return { allowed: true as const };
      });
      const sendMessage = vi.fn(async () => {
        expect(await countActivationConsumptions(setup.db)).toBe(1);
        return {
          status: "failed" as const,
          provider: "whatsapp_meta" as const,
          errorCode: "temporary_provider_failure" as const,
          classification: "temporary" as const,
          retryable: true,
        };
      });
      const dependencies = {
        adapter: readyAdapter(sendMessage),
        evaluatePolicy,
      };

      const initial = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        deliveryInput(setup, "whatsapp-meta-ready-budget-retry"),
        dependencies,
        {
          now,
          baseBackoffMs: 1_000,
          activationAuthorizationId: authorization.authorizationId,
        },
      );
      const resumed = await processMetaWhatsAppOutboundDeliveryWorker(
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
      expect(resumed).toMatchObject({ processed: 1, failed: 1 });
      expect(evaluatePolicy).toHaveBeenCalledTimes(2);
      expect(sendMessage).toHaveBeenCalledOnce();
      expect(await countActivationConsumptions(setup.db)).toBe(1);
      expect(await readMessageStatus(setup)).toEqual({
        status: "failed",
        safe_error_code:
          "channel_provider_activation_transport_outcome_uncertain",
      });
    },
    25_000,
  );

  it(
    "refuse un transport ready sans autorisation avant toute I/O",
    async () => {
      const setup = await createSetup();
      const http = readyHttpBoundary();
      const evaluatePolicy = vi.fn().mockReturnValue({ allowed: true });

      const result = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        deliveryInput(setup, "whatsapp-meta-ready-budget-missing"),
        { adapter: http.adapter, evaluatePolicy },
        { now: new Date(timestamp) },
      );

      expect(result).toMatchObject({
        status: "denied",
        classification: "policy",
        safeErrorCode: "channel_provider_activation_budget_invalid",
        retryable: false,
      });
      expect(evaluatePolicy).toHaveBeenCalledOnce();
      expectHttpBoundaryCalls(http, 0);
      expect(await countActivationConsumptions(setup.db)).toBe(0);
    },
    25_000,
  );

  it.each(["expired", "revoked"] as const)(
    "ferme en issue incertaine le retry worker après une autorisation %s",
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
        provider: "whatsapp_meta",
        errorCode: "temporary_provider_failure",
        classification: "temporary",
        retryable: true,
      });
      const dependencies = {
        adapter: readyAdapter(sendMessage),
        evaluatePolicy: vi.fn().mockReturnValue({ allowed: true }),
      };
      const initial = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        deliveryInput(setup, `whatsapp-meta-ready-retry-${mode}`),
        dependencies,
        {
          now,
          baseBackoffMs: 1_000,
          activationAuthorizationId: authorization.authorizationId,
        },
      );
      if (mode === "revoked") {
        await revokeWhatsAppMetaTrialAuthorization(setup.db, {
          tenantId: setup.tenant.id,
          actorId: setup.owner.id,
          authorizationId: authorization.authorizationId,
          occurredAt: new Date(now.getTime() + 500).toISOString(),
        });
      }

      const resumed = await processMetaWhatsAppOutboundDeliveryWorker(
        setup.db,
        setup.owner.id,
        setup.tenant.id,
        dependencies,
        { now: new Date(now.getTime() + 1_000), baseBackoffMs: 1_000 },
      );
      const delivery = await setup.db.query<{
        status: string;
        safe_error_code: string | null;
        activation_authorization_id: string | null;
      }>(
        `select status, safe_error_code, activation_authorization_id
         from channel_provider_deliveries
         where tenant_id = $1 and id = $2`,
        [setup.tenant.id, initial.deliveryId],
      );

      expect(resumed).toMatchObject({ processed: 1, failed: 1 });
      expect(sendMessage).toHaveBeenCalledOnce();
      expect(delivery.rows).toEqual([
        {
          status: "failed",
          safe_error_code:
            "channel_provider_activation_transport_outcome_uncertain",
          activation_authorization_id: authorization.authorizationId,
        },
      ]);
      expect(await countActivationConsumptions(setup.db)).toBe(1);
    },
    30_000,
  );

  it.each(["revoked", "expired"] as const)(
    "refuse une autorisation %s avant toute I/O",
    async (mode) => {
      const setup = await createSetup();
      const now = new Date(timestamp);
      const expiresAt = new Date(now.getTime() + 60_000).toISOString();
      const authorization = await issueActivationAuthorization(setup, expiresAt);
      const attemptedAt =
        mode === "expired"
          ? new Date(now.getTime() + 60_000)
          : new Date(now.getTime() + 30_000);
      if (mode === "revoked") {
        await revokeWhatsAppMetaTrialAuthorization(setup.db, {
          tenantId: setup.tenant.id,
          actorId: setup.owner.id,
          authorizationId: authorization.authorizationId,
          occurredAt: attemptedAt.toISOString(),
        });
      }
      const http = readyHttpBoundary();

      const result = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        deliveryInput(setup, `whatsapp-meta-ready-budget-${mode}`),
        {
          adapter: http.adapter,
          evaluatePolicy: () => ({ allowed: true }),
        },
        {
          now: attemptedAt,
          activationAuthorizationId: authorization.authorizationId,
        },
      );

      expect(result).toMatchObject({
        status: "denied",
        safeErrorCode: "channel_provider_activation_budget_invalid",
      });
      expectHttpBoundaryCalls(http, 0);
      expect(await countActivationConsumptions(setup.db)).toBe(0);
    },
    25_000,
  );

  it(
    "refuse la seconde livraison et une autorisation d’un autre tenant",
    async () => {
      const setup = await createSetup();
      const now = new Date(timestamp);
      const authorization = await issueActivationAuthorization(
        setup,
        new Date(now.getTime() + 60_000).toISOString(),
      );
      const http = readyHttpBoundary();
      const dependencies = {
        adapter: http.adapter,
        evaluatePolicy: () => ({ allowed: true as const }),
      };
      const first = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        deliveryInput(setup, "whatsapp-meta-ready-budget-first"),
        dependencies,
        {
          now,
          activationAuthorizationId: authorization.authorizationId,
        },
      );
      const replay = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        deliveryInput(setup, "whatsapp-meta-ready-budget-first"),
        dependencies,
        {
          now,
          activationAuthorizationId: authorization.authorizationId,
        },
      );
      expect(replay).toEqual({ ...first, idempotentReplay: true });
      expectHttpBoundaryCalls(http, 1);
      expect(await countActivationConsumptions(setup.db)).toBe(1);

      const secondMessageId = "message_whatsapp_meta_trial_second";
      await seedOutboundMessage(
        setup.db,
        setup.tenant.id,
        setup.threadId,
        setup.systemIdentityId,
        secondMessageId,
        "Second résultat métier.",
      );
      const exhausted = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        {
          ...deliveryInput(setup, "whatsapp-meta-ready-budget-second"),
          messageId: secondMessageId,
        },
        dependencies,
        {
          now,
          activationAuthorizationId: authorization.authorizationId,
        },
      );
      expect(exhausted).toMatchObject({
        status: "denied",
        safeErrorCode: "channel_provider_activation_budget_exhausted",
      });
      expectHttpBoundaryCalls(http, 1);

      const otherOwner = await setup.services.registerUser({
        name: "Responsable essai Meta externe",
        email: `meta-trial-other-${opened.length}@example.test`,
        password: "Password!1",
      });
      const otherTenant = await setup.services.createTenant(otherOwner.id, {
        name: "Autre organisation essai Meta",
        category: "Services",
      });
      const otherEndpoint = await registerAuthorizedMetaWhatsAppEndpoint(
        setup.db,
        {
          tenantId: otherTenant.id,
          actorId: otherOwner.id,
          externalAccountId: "333444555",
          phoneNumberId: "666777888",
          occurredAt: timestamp,
        },
        fingerprintSecret,
      );
      const otherAuthorization = await issueWhatsAppMetaTrialAuthorization(
        setup.db,
        {
          tenantId: otherTenant.id,
          actorId: otherOwner.id,
          endpointId: otherEndpoint.endpointId,
          idempotencyKey: "whatsapp-meta-other-tenant-authorization",
          freeUnitsConfirmed: true,
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
          occurredAt: timestamp,
        },
      );
      const thirdMessageId = "message_whatsapp_meta_trial_third";
      await seedOutboundMessage(
        setup.db,
        setup.tenant.id,
        setup.threadId,
        setup.systemIdentityId,
        thirdMessageId,
        "Troisième résultat métier.",
      );
      const crossTenant = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        {
          ...deliveryInput(setup, "whatsapp-meta-ready-budget-cross-tenant"),
          messageId: thirdMessageId,
        },
        dependencies,
        {
          now,
          activationAuthorizationId: otherAuthorization.authorizationId,
        },
      );
      expect(crossTenant).toMatchObject({
        status: "denied",
        safeErrorCode: "channel_provider_activation_budget_invalid",
      });
      expectHttpBoundaryCalls(http, 1);
      expect(await countActivationConsumptions(setup.db)).toBe(1);

      const disabledPolicy = vi.fn(() => ({ allowed: true as const }));
      const crossTenantReplay = await sendPreparedMetaWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        {
          ...deliveryInput(setup, "whatsapp-meta-ready-budget-cross-tenant"),
          messageId: thirdMessageId,
        },
        {
          adapter: createWhatsAppMetaOutboundAdapter({
            manifest: getPreparedChannelProvider("whatsapp_meta", {}),
          }),
          evaluatePolicy: disabledPolicy,
        },
        {
          now,
          activationAuthorizationId: otherAuthorization.authorizationId,
        },
      );
      expect(crossTenantReplay).toEqual({
        ...crossTenant,
        idempotentReplay: true,
      });
      expect(disabledPolicy).not.toHaveBeenCalled();
      expectHttpBoundaryCalls(http, 1);
    },
    30_000,
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
      kind: "mock",
      sendMessage:
        sendMessage as WhatsAppMetaOutboundTransport["sendMessage"],
    },
  });
}

function readyAdapter(sendMessage: ReturnType<typeof vi.fn>) {
  const base = getPreparedChannelProvider("whatsapp_meta", {});
  return createWhatsAppMetaOutboundAdapter({
    manifest: channelAdapterManifestSchema.parse({
      ...base,
      state: "ready",
      missingEnvironment: [],
      transportEnabled: true,
    }),
    transport: {
      kind: "http",
      sendMessage:
        sendMessage as WhatsAppMetaOutboundTransport["sendMessage"],
    },
  });
}

function readyHttpBoundary() {
  const resolveCredentials = vi.fn().mockResolvedValue({
    accessToken: `EAAG${"s".repeat(48)}`,
    phoneNumberId,
    graphApiVersion: "v23.0",
  });
  const resolveDestination = vi.fn().mockResolvedValue({
    recipientPhoneNumber: "+596696000000",
  });
  const fetch = vi.fn().mockResolvedValue({
    status: 200,
    text: vi.fn().mockResolvedValue(
      JSON.stringify({ messages: [{ id: providerMessageId }] }),
    ),
  });
  const base = getPreparedChannelProvider("whatsapp_meta", {});
  const adapter = createWhatsAppMetaOutboundAdapter({
    manifest: channelAdapterManifestSchema.parse({
      ...base,
      state: "ready",
      missingEnvironment: [],
      transportEnabled: true,
    }),
    transport: createWhatsAppMetaTransport({
      state: "ready",
      resolveCredentials,
      resolveDestination,
      fetch,
    }),
  });
  return { adapter, resolveCredentials, resolveDestination, fetch };
}

function expectHttpBoundaryCalls(
  boundary: ReturnType<typeof readyHttpBoundary>,
  count: number,
) {
  expect(boundary.resolveCredentials).toHaveBeenCalledTimes(count);
  expect(boundary.resolveDestination).toHaveBeenCalledTimes(count);
  expect(boundary.fetch).toHaveBeenCalledTimes(count);
}

function issueActivationAuthorization(
  setup: Awaited<ReturnType<typeof createSetup>>,
  expiresAt: string,
) {
  return issueWhatsAppMetaTrialAuthorization(setup.db, {
    tenantId: setup.tenant.id,
    actorId: setup.owner.id,
    endpointId: setup.endpointId,
    idempotencyKey: "whatsapp-meta-ready-activation-budget",
    freeUnitsConfirmed: true,
    expiresAt,
    occurredAt: timestamp,
  });
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
