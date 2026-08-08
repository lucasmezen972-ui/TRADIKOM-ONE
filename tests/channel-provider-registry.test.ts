import { afterEach, describe, expect, it, vi } from "vitest";
import {
  channelAdapterManifestSchema,
  getPreparedChannelProvider,
  incomingChannelWebhookSchema,
  listPreparedChannelProviders,
} from "../src/modules/channels";

describe("registre des canaux fournisseurs OS-2", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("garde les quatre transports désactivés par défaut sans accès réseau", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const providers = listPreparedChannelProviders({});

    expect(providers.map((provider) => provider.provider)).toEqual([
      "whatsapp_twilio",
      "teams_microsoft",
      "slack",
      "email_resend",
    ]);
    expect(providers.every((provider) => provider.state === "disabled")).toBe(
      true,
    );
    expect(
      providers.every((provider) => provider.transportEnabled === false),
    ).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reste non configuré si un feature flag est actif sans credentials", () => {
    const provider = getPreparedChannelProvider("whatsapp_twilio", {
      FEATURE_CHANNEL_WHATSAPP: "true",
      TWILIO_ACCOUNT_SID: "AC_test",
    });

    expect(provider).toMatchObject({
      state: "not_configured",
      transportEnabled: false,
      missingEnvironment: [
        "TWILIO_AUTH_TOKEN",
        "TWILIO_WHATSAPP_SENDER",
        "TWILIO_WHATSAPP_WEBHOOK_URL",
        "TWILIO_WHATSAPP_STATUS_CALLBACK_URL",
      ],
      signatureScheme: "twilio_sdk",
    });
  });

  it("attend toujours l'authentification humaine malgré une configuration complète", () => {
    const providers = listPreparedChannelProviders({
      FEATURE_CHANNEL_WHATSAPP: "true",
      TWILIO_ACCOUNT_SID: "AC_test",
      TWILIO_AUTH_TOKEN: "token_test",
      TWILIO_WHATSAPP_SENDER: "whatsapp:+15005550006",
      TWILIO_WHATSAPP_WEBHOOK_URL:
        "https://app.example.test/api/webhooks/twilio/whatsapp",
      TWILIO_WHATSAPP_STATUS_CALLBACK_URL:
        "https://app.example.test/api/webhooks/twilio/whatsapp/status",
      FEATURE_CHANNEL_TEAMS: "true",
      MICROSOFT_TENANT_ID: "tenant_test",
      MICROSOFT_CLIENT_ID: "client_test",
      MICROSOFT_CLIENT_SECRET: "secret_test",
      FEATURE_CHANNEL_SLACK: "true",
      SLACK_CLIENT_ID: "client_test",
      SLACK_CLIENT_SECRET: "secret_test",
      SLACK_SIGNING_SECRET: "signing_test",
      FEATURE_CHANNEL_EMAIL: "true",
      RESEND_API_KEY: "resend_test",
      EMAIL_FROM: "contact@example.test",
      RESEND_WEBHOOK_SECRET: "webhook_test",
    });

    expect(
      providers.every(
        (provider) => provider.state === "awaiting_human_auth",
      ),
    ).toBe(true);
    expect(
      providers.every((provider) => provider.transportEnabled === false),
    ).toBe(true);
  });

  it("interdit un faux état prêt et borne les webhooks avant vérification", () => {
    const manifest = getPreparedChannelProvider("slack", {});
    expect(() =>
      channelAdapterManifestSchema.parse({
        ...manifest,
        state: "ready",
        missingEnvironment: [],
      }),
    ).toThrow(/transport explicitement activé/i);

    expect(() =>
      incomingChannelWebhookSchema.parse({
        provider: "slack",
        url: "https://example.test/api/webhooks/slack",
        contentType: "application/json",
        rawBody: "x".repeat(512 * 1024 + 1),
        headers: {},
        receivedAt: "2026-07-30T15:00:00.000Z",
      }),
    ).toThrow();
  });
});
