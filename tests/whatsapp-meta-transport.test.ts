import { describe, expect, it, vi } from "vitest";
import {
  channelAdapterManifestSchema,
  createWhatsAppMetaOutboundAdapter,
  createWhatsAppMetaTransport,
  getPreparedChannelProvider,
  type ChannelAdapterState,
  type WhatsAppMetaTransportDependencies,
} from "../src/modules/channels";

const accessToken = `EAAG${"s".repeat(48)}`;
const phoneNumberId = "123456789012345";
const recipientPhoneNumber = "+596696000000";
const externalMessageId = `wamid.${"m".repeat(48)}`;
const request = {
  tenantId: "tenant_whatsapp_meta_transport",
  endpointId: "endpoint_whatsapp_meta_transport",
  channelIdentityId: "identity_whatsapp_meta_transport",
  messageId: "message_whatsapp_meta_transport",
  idempotencyKey: "whatsapp-meta-transport-idempotency",
  text: "Résultat métier prêt.",
};

describe("transport WhatsApp Meta Cloud API éphémère", () => {
  it.each(["disabled", "not_configured", "awaiting_human_auth"] as const)(
    "refuse l'état %s avant toute résolution ou requête HTTP",
    async (state) => {
      const resolveCredentials = vi.fn();
      const resolveDestination = vi.fn();
      const fetch = vi.fn();
      const transport = createWhatsAppMetaTransport({
        state,
        resolveCredentials,
        resolveDestination,
        fetch,
      });

      await expect(transport.sendMessage(request)).resolves.toMatchObject({
        status: state,
        provider: "whatsapp_meta",
        classification: "not_configured",
        retryable: false,
      });
      expect(resolveCredentials).not.toHaveBeenCalled();
      expect(resolveDestination).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("résout les références sûres et transmet uniquement le contrat Graph attendu", async () => {
    const calls: string[] = [];
    const resolveCredentials = vi.fn(async () => {
      calls.push("credentials");
      return { accessToken, phoneNumberId, graphApiVersion: "v23.0" };
    });
    const resolveDestination = vi.fn(async () => {
      calls.push("destination");
      return { recipientPhoneNumber };
    });
    const fetch = vi.fn(async () => {
      calls.push("fetch");
      return response(200, { messages: [{ id: externalMessageId }] });
    });
    const transport = createWhatsAppMetaTransport({
      state: "mock",
      resolveCredentials,
      resolveDestination,
      fetch,
    });

    await expect(transport.sendMessage(request)).resolves.toEqual({
      status: "accepted",
      provider: "whatsapp_meta",
      externalMessageId,
      retryable: false,
    });
    expect(calls).toEqual(["credentials", "destination", "fetch"]);
    expect(resolveCredentials).toHaveBeenCalledWith({
      tenantId: request.tenantId,
      endpointId: request.endpointId,
    });
    expect(resolveDestination).toHaveBeenCalledWith({
      tenantId: request.tenantId,
      endpointId: request.endpointId,
      channelIdentityId: request.channelIdentityId,
    });
    expect(fetch).toHaveBeenCalledWith(
      `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`,
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipientPhoneNumber.slice(1),
          type: "text",
          text: { preview_url: false, body: request.text },
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    { ...request, endpointId: undefined },
    { ...request, endpointId: "endpoint/invalide" },
  ])("refuse une référence invalide avant les résolveurs", async (input) => {
    const dependencies = baseDependencies({
      resolveCredentials: vi.fn(),
      resolveDestination: vi.fn(),
      fetch: vi.fn(),
    });

    await expect(
      createWhatsAppMetaTransport(dependencies).sendMessage(input),
    ).resolves.toMatchObject({
      status: "failed",
      classification: "validation",
      retryable: false,
    });
    expect(dependencies.resolveCredentials).not.toHaveBeenCalled();
    expect(dependencies.resolveDestination).not.toHaveBeenCalled();
    expect(dependencies.fetch).not.toHaveBeenCalled();
  });

  it("reste non configuré si les credentials ne peuvent pas être résolus", async () => {
    const resolveDestination = vi.fn();
    const fetch = vi.fn();
    const dependencies = baseDependencies({
      resolveCredentials: vi.fn().mockResolvedValue(null),
      resolveDestination,
      fetch,
    });

    await expect(
      createWhatsAppMetaTransport(dependencies).sendMessage(request),
    ).resolves.toMatchObject({
      status: "not_configured",
      classification: "not_configured",
      retryable: false,
    });
    expect(resolveDestination).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { accessToken: "court", phoneNumberId, graphApiVersion: "v23.0" },
    { accessToken, phoneNumberId: "phone-id", graphApiVersion: "v23.0" },
    { accessToken, phoneNumberId, graphApiVersion: "latest" },
  ])("refuse des credentials invalides avant la destination", async (credentials) => {
    const resolveDestination = vi.fn();
    const fetch = vi.fn();
    const dependencies = baseDependencies({
      resolveCredentials: vi.fn().mockResolvedValue(credentials),
      resolveDestination,
      fetch,
    });

    await expect(
      createWhatsAppMetaTransport(dependencies).sendMessage(request),
    ).resolves.toMatchObject({
      status: "failed",
      classification: "auth",
      retryable: false,
    });
    expect(resolveDestination).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuse une destination invalide avant toute requête HTTP", async () => {
    const fetch = vi.fn();
    const dependencies = baseDependencies({
      resolveDestination: vi
        .fn()
        .mockResolvedValue({ recipientPhoneNumber: "596 696 00 00 00" }),
      fetch,
    });

    await expect(
      createWhatsAppMetaTransport(dependencies).sendMessage(request),
    ).resolves.toMatchObject({
      status: "failed",
      classification: "validation",
      retryable: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    response(200, "pas du json"),
    response(200, { messages: [] }),
    response(200, { messages: [{ id: "x".repeat(257) }] }),
    response(200, "x".repeat(64 * 1024 + 1)),
  ])("refuse une réponse Graph non conforme sans détail brut", async (httpResponse) => {
    const adapter = createWhatsAppMetaOutboundAdapter({
      manifest: mockManifest(),
      transport: createWhatsAppMetaTransport(
        baseDependencies({
          fetch: vi.fn().mockResolvedValue(httpResponse),
        }),
      ),
    });

    await expect(adapter.sendMessage(request)).resolves.toMatchObject({
      status: "failed",
      classification: "validation",
      errorCode: "validation_failed",
      retryable: false,
    });
  });

  it.each([
    [401, "auth", "authentication_failed", false],
    [403, "auth", "authentication_failed", false],
    [429, "rate_limit", "rate_limited", true],
    [503, "temporary", "temporary_provider_failure", true],
    [422, "permanent", "permanent_provider_failure", false],
  ] as const)(
    "classe le statut HTTP %s en %s sans propager les données sensibles",
    async (status, classification, errorCode, retryable) => {
      const fetch = vi.fn().mockResolvedValue(
        response(status, {
          error: { message: "détail sensible du fournisseur" },
        }),
      );
      const adapter = createWhatsAppMetaOutboundAdapter({
        manifest: mockManifest(),
        transport: createWhatsAppMetaTransport(
          baseDependencies({ fetch }),
        ),
      });
      const serialized = JSON.stringify(await adapter.sendMessage(request));

      expect(JSON.parse(serialized)).toMatchObject({
        status: "failed",
        classification,
        errorCode,
        retryable,
      });
      expect(serialized).not.toContain(accessToken);
      expect(serialized).not.toContain(recipientPhoneNumber);
      expect(serialized).not.toContain(request.text);
      expect(serialized).not.toContain("détail sensible");
    },
  );

  it("classe une panne réseau en échec temporaire sans fuite", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new TypeError("réseau avec détail sensible"));
    const adapter = createWhatsAppMetaOutboundAdapter({
      manifest: mockManifest(),
      transport: createWhatsAppMetaTransport(baseDependencies({ fetch })),
    });
    const serialized = JSON.stringify(await adapter.sendMessage(request));

    expect(JSON.parse(serialized)).toMatchObject({
      status: "failed",
      classification: "temporary",
      errorCode: "temporary_provider_failure",
      retryable: true,
    });
    expect(serialized).not.toContain("détail sensible");
    expect(serialized).not.toContain(accessToken);
    expect(serialized).not.toContain(recipientPhoneNumber);
    expect(serialized).not.toContain(request.text);
  });
});

function baseDependencies(
  overrides: Partial<WhatsAppMetaTransportDependencies> = {},
): WhatsAppMetaTransportDependencies {
  return {
    state: "mock",
    resolveCredentials: vi.fn().mockResolvedValue({
      accessToken,
      phoneNumberId,
      graphApiVersion: "v23.0",
    }),
    resolveDestination: vi
      .fn()
      .mockResolvedValue({ recipientPhoneNumber }),
    fetch: vi
      .fn()
      .mockResolvedValue(
        response(200, { messages: [{ id: externalMessageId }] }),
      ),
    ...overrides,
  };
}

function mockManifest(state: ChannelAdapterState = "mock") {
  const base = getPreparedChannelProvider("whatsapp_meta", {});
  return channelAdapterManifestSchema.parse({
    ...base,
    state,
    missingEnvironment: [],
    transportEnabled: state === "mock" || state === "ready",
  });
}

function response(status: number, body: unknown) {
  return {
    status,
    text: vi
      .fn()
      .mockResolvedValue(typeof body === "string" ? body : JSON.stringify(body)),
  };
}
