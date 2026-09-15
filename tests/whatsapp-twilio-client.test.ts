import { describe, expect, it, vi } from "vitest";
import {
  createOfficialWhatsAppTwilioClientFactory,
  createWhatsAppTwilioTransport,
  type ChannelAdapterState,
  type TwilioSdkClientFactory,
} from "../src/modules/channels";

const accountSid = `AC${"a".repeat(32)}`;
const authToken = "twilio-client-secret-test-only";
const messageSid = `SM${"b".repeat(32)}`;
const statusCallbackUrl =
  "https://app.example.test/api/webhooks/twilio/whatsapp/status";
const request = {
  tenantId: "tenant_client",
  endpointId: "endpoint_client",
  channelIdentityId: "identity_client",
  messageId: "message_client",
  idempotencyKey: "whatsapp-client-idempotency",
  text: "Résultat métier prêt.",
};

describe("fabrique officielle du client WhatsApp/Twilio", () => {
  it("construit le SDK officiel avec des credentials factices sans appel réseau", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const factory = createOfficialWhatsAppTwilioClientFactory();
    const client = factory({ accountSid, authToken });

    expect(client.messages.create).toBeTypeOf("function");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("borne le SDK sans réseau à la construction et traduit uniquement messages.create", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const createMessage = vi
      .fn()
      .mockResolvedValue({ sid: messageSid, status: "queued" });
    const createSdkClient = vi.fn(() => ({
      messages: { create: createMessage },
    })) as unknown as TwilioSdkClientFactory;
    const factory = createOfficialWhatsAppTwilioClientFactory(
      { timeoutMs: 8_000, maxSockets: 3 },
      createSdkClient,
    );

    expect(createSdkClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    const client = factory({ accountSid, authToken });
    expect(createSdkClient).toHaveBeenCalledWith(accountSid, authToken, {
      autoRetry: false,
      maxRetries: 0,
      lazyLoading: true,
      timeout: 8_000,
      keepAlive: true,
      maxSockets: 3,
      maxTotalSockets: 3,
      maxFreeSockets: 1,
      scheduling: "fifo",
    });
    expect(createMessage).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    await expect(
      client.messages.create({
        from: "whatsapp:+15005550006",
        to: "whatsapp:+596696000000",
        body: request.text,
        statusCallback: statusCallbackUrl,
      }),
    ).resolves.toEqual({ sid: messageSid, status: "queued" });
    expect(createMessage).toHaveBeenCalledOnce();
  });

  it.each(["disabled", "not_configured", "awaiting_human_auth"] as const)(
    "ne construit pas le SDK en état %s",
    async (state: ChannelAdapterState) => {
      const createSdkClient = vi.fn();
      const transport = createWhatsAppTwilioTransport({
        state,
        statusCallbackUrl,
        resolveCredentials: vi.fn().mockResolvedValue({ accountSid, authToken }),
        resolveDestination: vi.fn().mockResolvedValue({
          senderAddress: "whatsapp:+15005550006",
          recipientAddress: "whatsapp:+596696000000",
        }),
        createClient: createOfficialWhatsAppTwilioClientFactory(
          {},
          createSdkClient as unknown as TwilioSdkClientFactory,
        ),
      });

      await expect(transport.sendMessage(request)).resolves.toMatchObject({
        status: state,
        classification: "not_configured",
      });
      expect(createSdkClient).not.toHaveBeenCalled();
    },
  );

  it("refuse credentials et options invalides sans exposer leur valeur", () => {
    const createSdkClient = vi.fn();
    const secret = "credential-that-must-not-leak";
    expect(() =>
      createOfficialWhatsAppTwilioClientFactory(
        { timeoutMs: 999 },
        createSdkClient as unknown as TwilioSdkClientFactory,
      ),
    ).toThrow(/transport WhatsApp/i);

    const factory = createOfficialWhatsAppTwilioClientFactory(
      {},
      createSdkClient as unknown as TwilioSdkClientFactory,
    );
    try {
      factory({ accountSid: "AC_invalide", authToken: secret });
      throw new Error("Expected the client factory to reject credentials.");
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
    expect(createSdkClient).not.toHaveBeenCalled();
  });
});
