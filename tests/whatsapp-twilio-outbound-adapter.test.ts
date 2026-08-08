import { describe, expect, it, vi } from "vitest";
import {
  channelAdapterManifestSchema,
  createWhatsAppTwilioOutboundAdapter,
  getPreparedChannelProvider,
  type WhatsAppTwilioOutboundTransport,
  WhatsAppTwilioTransportError,
} from "../src/modules/channels";

const request = {
  tenantId: "tenant_whatsapp_outbound",
  channelIdentityId: "identity_whatsapp_outbound",
  messageId: "message_whatsapp_outbound",
  idempotencyKey: "whatsapp-outbound-idempotency",
  text: "Réponse WhatsApp préparée",
};

describe("adaptateur sortant WhatsApp/Twilio préparé", () => {
  it.each([
    ["disabled", {}, "channel_disabled"],
    [
      "not_configured",
      { FEATURE_CHANNEL_WHATSAPP: "true" },
      "channel_not_configured",
    ],
    [
      "awaiting_human_auth",
      {
        FEATURE_CHANNEL_WHATSAPP: "true",
        TWILIO_ACCOUNT_SID: "AC_test",
        TWILIO_AUTH_TOKEN: "token_test",
        TWILIO_WHATSAPP_SENDER: "whatsapp:+15005550006",
        TWILIO_WHATSAPP_WEBHOOK_URL:
          "https://app.example.test/api/webhooks/twilio/whatsapp",
      },
      "awaiting_human_auth",
    ],
  ] as const)(
    "reste fail-closed en état %s avant le client",
    async (state, environment, errorCode) => {
      const sendMessage = vi.fn();
      const adapter = createWhatsAppTwilioOutboundAdapter({
        manifest: getPreparedChannelProvider(
          "whatsapp_twilio",
          environment,
        ),
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
      provider: "whatsapp_twilio",
      externalMessageId: `SM${"a".repeat(32)}`,
      retryable: false,
    });
    const adapter = createMockAdapter(sendMessage);

    await expect(adapter.sendMessage(request)).resolves.toMatchObject({
      status: "accepted",
      provider: "whatsapp_twilio",
    });
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(request);
  });

  it("refuse un contenu invalide avant le transport", async () => {
    const sendMessage = vi.fn();
    const adapter = createMockAdapter(sendMessage);

    await expect(
      adapter.sendMessage({ ...request, text: "x".repeat(1_601) }),
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
        .mockRejectedValue(new WhatsAppTwilioTransportError(classification));
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

function createMockAdapter(sendMessage: ReturnType<typeof vi.fn>) {
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
