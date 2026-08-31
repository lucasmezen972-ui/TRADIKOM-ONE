import { describe, expect, it, vi } from "vitest";
import {
  channelAdapterManifestSchema,
  createWhatsAppMetaOutboundAdapter,
  getPreparedChannelProvider,
  type WhatsAppMetaOutboundTransport,
  WhatsAppMetaTransportError,
} from "../src/modules/channels";

const request = {
  tenantId: "tenant_whatsapp_meta_outbound",
  channelIdentityId: "identity_whatsapp_meta_outbound",
  messageId: "message_whatsapp_meta_outbound",
  idempotencyKey: "whatsapp-meta-outbound-idempotency",
  text: "Réponse WhatsApp Meta préparée",
};

describe("adaptateur sortant WhatsApp Meta préparé", () => {
  it.each([
    ["disabled", {}, "channel_disabled"],
    [
      "not_configured",
      { FEATURE_CHANNEL_WHATSAPP_META: "true" },
      "channel_not_configured",
    ],
    [
      "awaiting_human_auth",
      readyEnvironment(),
      "awaiting_human_auth",
    ],
  ] as const)(
    "reste fail-closed en état %s avant le transport",
    async (state, environment, errorCode) => {
      const sendMessage = vi.fn();
      const adapter = createWhatsAppMetaOutboundAdapter({
        manifest: getPreparedChannelProvider("whatsapp_meta", environment),
        transport: { sendMessage },
      });

      await expect(adapter.sendMessage(request)).resolves.toMatchObject({
        status: state,
        classification: "not_configured",
        errorCode,
        retryable: false,
      });
      expect(sendMessage).not.toHaveBeenCalled();
    },
  );

  it("envoie uniquement avec un transport mock explicitement injecté", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      status: "accepted",
      provider: "whatsapp_meta",
      externalMessageId: `wamid.${"a".repeat(32)}`,
      retryable: false,
    });
    const adapter = createMockAdapter(sendMessage);

    await expect(adapter.sendMessage(request)).resolves.toMatchObject({
      status: "accepted",
      provider: "whatsapp_meta",
    });
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(request);
  });

  it("refuse même un état ready injecté avant une activation dédiée", async () => {
    const sendMessage = vi.fn();
    const base = getPreparedChannelProvider("whatsapp_meta", {});
    const adapter = createWhatsAppMetaOutboundAdapter({
      manifest: channelAdapterManifestSchema.parse({
        ...base,
        state: "ready",
        missingEnvironment: [],
        transportEnabled: true,
      }),
      transport: { sendMessage },
    });

    await expect(adapter.sendMessage(request)).resolves.toMatchObject({
      status: "awaiting_human_auth",
      classification: "not_configured",
      errorCode: "awaiting_human_auth",
      retryable: false,
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("refuse un contenu invalide avant le transport", async () => {
    const sendMessage = vi.fn();
    const adapter = createMockAdapter(sendMessage);

    await expect(
      adapter.sendMessage({ ...request, text: "x".repeat(4_097) }),
    ).resolves.toMatchObject({
      status: "failed",
      classification: "validation",
      errorCode: "validation_failed",
      retryable: false,
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["temporary", "temporary_provider_failure", true],
    ["permanent", "permanent_provider_failure", false],
    ["auth", "authentication_failed", false],
    ["rate_limit", "rate_limited", true],
  ] as const)(
    "normalise l'échec %s sans propager le détail fournisseur",
    async (classification, errorCode, retryable) => {
      const sendMessage = vi
        .fn()
        .mockRejectedValue(new WhatsAppMetaTransportError(classification));
      const serialized = JSON.stringify(
        await createMockAdapter(sendMessage).sendMessage(request),
      );

      expect(JSON.parse(serialized)).toMatchObject({
        status: "failed",
        classification,
        errorCode,
        retryable,
      });
      expect(serialized).not.toContain(request.text);
    },
  );
});

function readyEnvironment() {
  return {
    FEATURE_CHANNEL_WHATSAPP_META: "true",
    META_WHATSAPP_APP_SECRET: "test-app-secret",
    META_WHATSAPP_ACCESS_TOKEN: "test-access-token",
    META_WHATSAPP_PHONE_NUMBER_ID: "123456789",
    META_WHATSAPP_WABA_ID: "987654321",
    META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: "test-verify-token",
    META_WHATSAPP_WEBHOOK_URL:
      "https://app.example.test/api/webhooks/meta/whatsapp",
    CHANNEL_PROVIDER_SECRET_ACTIVE_KEY_VERSION: "test-v1",
    CHANNEL_PROVIDER_SECRET_KEY_REFERENCES:
      '[{"version":"test-v1","reference":"test-secret://channel-key/test-v1"}]',
  };
}

function createMockAdapter(sendMessage: ReturnType<typeof vi.fn>) {
  const base = getPreparedChannelProvider("whatsapp_meta", {});
  const manifest = channelAdapterManifestSchema.parse({
    ...base,
    state: "mock",
    missingEnvironment: [],
    transportEnabled: true,
  });
  return createWhatsAppMetaOutboundAdapter({
    manifest,
    transport: {
      sendMessage:
        sendMessage as WhatsAppMetaOutboundTransport["sendMessage"],
    },
  });
}
