import { describe, expect, it, vi } from "vitest";
import {
  channelAdapterManifestSchema,
  createWhatsAppTwilioOutboundAdapter,
  createWhatsAppTwilioTransport,
  getPreparedChannelProvider,
  type ChannelAdapterState,
  type WhatsAppTwilioTransportDependencies,
} from "../src/modules/channels";

const accountSid = `AC${"a".repeat(32)}`;
const authToken = "twilio-auth-token-never-persisted";
const messageSid = `SM${"b".repeat(32)}`;
const senderAddress = "whatsapp:+15005550006";
const recipientAddress = "whatsapp:+596696000000";
const statusCallbackUrl =
  "https://app.example.test/api/webhooks/twilio/whatsapp/status";
const request = {
  tenantId: "tenant_whatsapp_transport",
  endpointId: "endpoint_whatsapp_transport",
  channelIdentityId: "identity_whatsapp_transport",
  messageId: "message_whatsapp_transport",
  idempotencyKey: "whatsapp-transport-idempotency",
  text: "Résultat métier prêt.",
};

describe("transport WhatsApp/Twilio éphémère", () => {
  it.each(["disabled", "not_configured", "awaiting_human_auth"] as const)(
    "refuse l'état %s avant toute résolution ou construction du client",
    async (state) => {
      const resolveCredentials = vi.fn();
      const resolveDestination = vi.fn();
      const createClient = vi.fn();
      const transport = createWhatsAppTwilioTransport({
        state,
        statusCallbackUrl,
        resolveCredentials,
        resolveDestination,
        createClient,
      });

      await expect(transport.sendMessage(request)).resolves.toMatchObject({
        status: state,
        classification: "not_configured",
        retryable: false,
      });
      expect(resolveCredentials).not.toHaveBeenCalled();
      expect(resolveDestination).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it("résout par références sûres et transmet seulement le payload Twilio attendu", async () => {
    const calls: string[] = [];
    const createMessage = vi.fn(async () => {
      calls.push("message");
      return { sid: messageSid, status: "queued" };
    });
    const resolveCredentials = vi.fn(async () => {
      calls.push("credentials");
      return { accountSid, authToken };
    });
    const resolveDestination = vi.fn(async () => {
      calls.push("destination");
      return { senderAddress, recipientAddress };
    });
    const createClient = vi.fn(() => {
      calls.push("client");
      return { messages: { create: createMessage } };
    });
    const transport = createWhatsAppTwilioTransport({
      state: "mock",
      statusCallbackUrl,
      resolveCredentials,
      resolveDestination,
      createClient,
    });

    await expect(transport.sendMessage(request)).resolves.toEqual({
      status: "accepted",
      provider: "whatsapp_twilio",
      externalMessageId: messageSid,
      retryable: false,
    });
    expect(calls).toEqual(["credentials", "destination", "client", "message"]);
    expect(resolveCredentials).toHaveBeenCalledWith({
      tenantId: request.tenantId,
      endpointId: request.endpointId,
    });
    expect(resolveDestination).toHaveBeenCalledWith({
      tenantId: request.tenantId,
      endpointId: request.endpointId,
      channelIdentityId: request.channelIdentityId,
    });
    expect(createClient).toHaveBeenCalledWith({ accountSid, authToken });
    expect(createMessage).toHaveBeenCalledWith({
      from: senderAddress,
      to: recipientAddress,
      body: request.text,
      statusCallback: statusCallbackUrl,
    });
  });

  it.each([
    [{ ...request, endpointId: undefined }, statusCallbackUrl],
    [request, "http://app.example.test/status"],
    [request, "https://user:secret@app.example.test/status"],
    [request, "https://app_example.test/status"],
  ] as const)(
    "refuse une référence ou URL de callback invalide avant les résolveurs",
    async (transportRequest, callbackUrl) => {
      const resolveCredentials = vi.fn();
      const dependencies = baseDependencies({
        statusCallbackUrl: callbackUrl,
        resolveCredentials,
      });

      await expect(
        createWhatsAppTwilioTransport(dependencies).sendMessage(
          transportRequest,
        ),
      ).resolves.toMatchObject({
        status: "failed",
        classification: "validation",
        retryable: false,
      });
      expect(resolveCredentials).not.toHaveBeenCalled();
      expect(dependencies.resolveDestination).not.toHaveBeenCalled();
      expect(dependencies.createClient).not.toHaveBeenCalled();
    },
  );

  it("reste non configuré si une référence sûre ne peut pas être résolue", async () => {
    const resolveDestination = vi.fn();
    const createClient = vi.fn();
    const dependencies = baseDependencies({
      resolveCredentials: vi.fn().mockResolvedValue(null),
      resolveDestination,
      createClient,
    });

    await expect(
      createWhatsAppTwilioTransport(dependencies).sendMessage(request),
    ).resolves.toMatchObject({
      status: "not_configured",
      classification: "not_configured",
      retryable: false,
    });
    expect(resolveDestination).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuse les credentials invalides avant destination et client", async () => {
    const resolveDestination = vi.fn();
    const createClient = vi.fn();
    const dependencies = baseDependencies({
      resolveCredentials: vi.fn().mockResolvedValue({
        accountSid: "AC_invalide",
        authToken,
      }),
      resolveDestination,
      createClient,
    });

    await expect(
      createWhatsAppTwilioTransport(dependencies).sendMessage(request),
    ).resolves.toMatchObject({
      status: "failed",
      classification: "auth",
      retryable: false,
    });
    expect(resolveDestination).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuse les adresses invalides avant de construire le client", async () => {
    const createClient = vi.fn();
    const dependencies = baseDependencies({
      resolveDestination: vi.fn().mockResolvedValue({
        senderAddress,
        recipientAddress: "+596696000000",
      }),
      createClient,
    });

    await expect(
      createWhatsAppTwilioTransport(dependencies).sendMessage(request),
    ).resolves.toMatchObject({
      status: "failed",
      classification: "validation",
      retryable: false,
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    [{ sid: "SM_invalide", status: "queued" }],
    [{ sid: messageSid, status: "scheduled" }],
  ])("refuse une réponse client non conforme sans détail brut", async (response) => {
    const transport = createWhatsAppTwilioTransport(
      baseDependencies({
        createClient: () => ({
          messages: { create: vi.fn().mockResolvedValue(response) },
        }),
      }),
    );
    const adapter = createWhatsAppTwilioOutboundAdapter({
      manifest: mockManifest(),
      transport,
    });

    await expect(adapter.sendMessage(request)).resolves.toMatchObject({
      status: "failed",
      classification: "validation",
      errorCode: "validation_failed",
      retryable: false,
    });
  });

  it.each([
    [{ status: 401, code: 20_003 }, "auth", "authentication_failed", false],
    [{ status: 429, code: 20_429 }, "rate_limit", "rate_limited", true],
    [{ status: 503, code: 20_503 }, "temporary", "temporary_provider_failure", true],
    [{ status: 422, code: 21_216 }, "permanent", "permanent_provider_failure", false],
    [new TypeError("network contains sensitive detail"), "temporary", "temporary_provider_failure", true],
  ] as const)(
    "classe l'erreur client en %s sans propager le détail brut",
    async (clientError, classification, errorCode, retryable) => {
      const transport = createWhatsAppTwilioTransport(
        baseDependencies({
          createClient: () => ({
            messages: {
              create: vi.fn().mockRejectedValue(clientError),
            },
          }),
        }),
      );
      const adapter = createWhatsAppTwilioOutboundAdapter({
        manifest: mockManifest(),
        transport,
      });
      const serialized = JSON.stringify(await adapter.sendMessage(request));

      expect(JSON.parse(serialized)).toMatchObject({
        status: "failed",
        classification,
        errorCode,
        retryable,
      });
      expect(serialized).not.toContain(authToken);
      expect(serialized).not.toContain(senderAddress);
      expect(serialized).not.toContain(recipientAddress);
      expect(serialized).not.toContain(request.text);
      expect(serialized).not.toContain("sensitive detail");
    },
  );
});

function baseDependencies(
  overrides: Partial<WhatsAppTwilioTransportDependencies> = {},
): WhatsAppTwilioTransportDependencies {
  return {
    state: "mock",
    statusCallbackUrl,
    resolveCredentials: vi.fn().mockResolvedValue({ accountSid, authToken }),
    resolveDestination: vi
      .fn()
      .mockResolvedValue({ senderAddress, recipientAddress }),
    createClient: vi.fn(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({ sid: messageSid, status: "queued" }),
      },
    })),
    ...overrides,
  };
}

function mockManifest(state: ChannelAdapterState = "mock") {
  const base = getPreparedChannelProvider("whatsapp_twilio", {});
  return channelAdapterManifestSchema.parse({
    ...base,
    state,
    missingEnvironment: [],
    transportEnabled: state === "mock" || state === "ready",
  });
}
