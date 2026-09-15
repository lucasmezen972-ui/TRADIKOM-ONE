import { describe, expect, it, vi } from "vitest";
import {
  channelAdapterManifestSchema,
  composeWhatsAppTwilioActivation,
  getPreparedChannelProvider,
  inspectWhatsAppTwilioReadiness,
  type ChannelProviderSecretKeyring,
  type WhatsAppTwilioActivationDependencies,
  type WhatsAppTwilioStoredActivationAuthorization,
} from "../src/modules/channels";

const now = "2026-08-08T17:30:00.000-04:00";
const tenantId = "tenant_readiness";
const environment = {
  FEATURE_CHANNEL_WHATSAPP: "true",
  TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  TWILIO_AUTH_TOKEN: "test-only-not-a-real-token",
  TWILIO_WHATSAPP_SENDER: "whatsapp:+15005550006",
  CHANNEL_PROVIDER_SECRET_ACTIVE_KEY_VERSION: "managed-v2",
  CHANNEL_PROVIDER_SECRET_KEY_REFERENCES: JSON.stringify([
    {
      version: "managed-v2",
      reference: "test-secret://channel-key/managed-v2",
    },
  ]),
  TWILIO_WHATSAPP_WEBHOOK_URL:
    "https://app.example.test/api/webhooks/twilio/whatsapp",
  TWILIO_WHATSAPP_STATUS_CALLBACK_URL:
    "https://app.example.test/api/webhooks/twilio/whatsapp/status",
};
const endpoint = {
  tenantId,
  endpointId: "endpoint_readiness",
  provider: "whatsapp_twilio" as const,
  status: "active" as const,
};
const authorization = {
  authorizationId: "authorization_readiness",
  tenantId,
  endpointId: endpoint.endpointId,
  provider: "whatsapp_twilio" as const,
  authorizedBy: "user_readiness",
  authorizedAt: "2026-08-08T17:25:00.000-04:00",
  expiresAt: "2026-08-08T18:00:00.000-04:00",
  scope: "twilio_whatsapp_sandbox" as const,
  maxMessages: 2,
  freeUnitsConfirmed: true as const,
  revokedAt: null,
} satisfies WhatsAppTwilioStoredActivationAuthorization;

describe("readiness WhatsApp/Twilio OS-5", () => {
  it("refuse le canal désactivé avant toute composition ou résolution", async () => {
    const dependencies = blockedDependencies();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await composeWhatsAppTwilioActivation(
      {
        tenantId,
        manifest: getPreparedChannelProvider("whatsapp_twilio", {}),
        environment,
        endpoint,
        authorizationId: authorization.authorizationId,
        now,
      },
      dependencies,
    );

    expect(result).toMatchObject({
      readiness: {
        state: "disabled",
        activationAllowed: false,
        checks: { manifest: "disabled", keyReferences: "not_checked" },
      },
      transport: null,
    });
    expectNoActivation(dependencies);
    expect(dependencies.loadAuthorization).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("distingue références invalides, endpoint d'un autre tenant et URLs non sûres", async () => {
    const manifest = getPreparedChannelProvider("whatsapp_twilio", environment);
    const loadAuthorization = vi.fn();
    const readiness = await inspectWhatsAppTwilioReadiness(
      {
        tenantId,
        manifest,
        environment: {
          ...environment,
          CHANNEL_PROVIDER_SECRET_KEY_REFERENCES:
            '[{"version":"managed-v2","reference":"valeur-en-clair"}]',
          TWILIO_WHATSAPP_WEBHOOK_URL: "http://localhost/webhook",
          TWILIO_WHATSAPP_STATUS_CALLBACK_URL:
            "https://user:password@app.example.test/status",
        },
        endpoint: { ...endpoint, tenantId: "tenant_outsider" },
        authorizationId: authorization.authorizationId,
        now,
      },
      loadAuthorization,
    );

    expect(readiness).toMatchObject({
      state: "not_configured",
      activationAllowed: false,
      checks: {
        keyReferences: "invalid",
        endpoint: "tenant_mismatch",
        webhookUrl: "invalid",
        statusCallbackUrl: "invalid",
      },
    });
    expect(JSON.stringify(readiness)).not.toContain("valeur-en-clair");
    expect(JSON.stringify(readiness)).not.toContain("password");
    expect(loadAuthorization).not.toHaveBeenCalled();
  });

  it("demande une autorisation humaine bornée sans construire le runtime", async () => {
    const dependencies = blockedDependencies();
    const result = await composeWhatsAppTwilioActivation(
      {
        tenantId,
        manifest: getPreparedChannelProvider("whatsapp_twilio", environment),
        environment,
        endpoint,
        now,
      },
      dependencies,
    );

    expect(result.readiness).toMatchObject({
      state: "awaiting_human_auth",
      activationAllowed: false,
      checks: {
        manifest: "prepared",
        keyReferences: "valid",
        endpoint: "active",
        webhookUrl: "valid",
        statusCallbackUrl: "valid",
        humanAuthorization: "required",
      },
    });
    expect(result.transport).toBeNull();
    expectNoActivation(dependencies);
    expect(dependencies.loadAuthorization).not.toHaveBeenCalled();
  });

  it("reste dégradé après autorisation tant que le registre ne produit pas ready", async () => {
    const dependencies = blockedDependencies();
    const result = await composeWhatsAppTwilioActivation(
      {
        tenantId,
        manifest: getPreparedChannelProvider("whatsapp_twilio", environment),
        environment,
        endpoint,
        authorizationId: authorization.authorizationId,
        now,
      },
      dependencies,
    );

    expect(result.readiness).toMatchObject({
      state: "degraded",
      activationAllowed: false,
      checks: { humanAuthorization: "valid" },
    });
    expect(result.transport).toBeNull();
    expectNoActivation(dependencies);
    expect(dependencies.loadAuthorization).toHaveBeenCalledWith({
      tenantId,
      endpointId: endpoint.endpointId,
      authorizationId: authorization.authorizationId,
    });
  });

  it("échoue fermé en état dégradé si le chargement interne est indisponible", async () => {
    const dependencies = blockedDependencies();
    dependencies.loadAuthorization.mockRejectedValue(
      new Error("détail base non exposable"),
    );
    const result = await composeWhatsAppTwilioActivation(
      {
        tenantId,
        manifest: getPreparedChannelProvider("whatsapp_twilio", environment),
        environment,
        endpoint,
        authorizationId: authorization.authorizationId,
        now,
      },
      dependencies,
    );

    expect(result).toMatchObject({
      readiness: {
        state: "degraded",
        activationAllowed: false,
        checks: { humanAuthorization: "unavailable" },
      },
      transport: null,
    });
    expect(JSON.stringify(result)).not.toContain("détail base non exposable");
    expectNoActivation(dependencies);
  });

  it.each(
    [
      { ...authorization, expiresAt: now },
      { ...authorization, tenantId: "tenant_outsider" },
      { ...authorization, maxMessages: 3 },
      { ...authorization, freeUnitsConfirmed: false },
      { ...authorization, revokedAt: "2026-08-08T17:28:00.000-04:00" },
      { ...authorization, endpointId: "endpoint_outsider" },
      { ...authorization, provider: "slack" },
    ] as unknown as WhatsAppTwilioStoredActivationAuthorization[],
  )("refuse une autorisation persistée expirée ou hors contrat", async (stored) => {
    const readiness = await inspectWhatsAppTwilioReadiness(
      {
        tenantId,
        manifest: getPreparedChannelProvider("whatsapp_twilio", environment),
        environment,
        endpoint,
        authorizationId: authorization.authorizationId,
        now,
      },
      vi.fn().mockResolvedValue(stored),
    );

    expect(readiness.state).toBe("awaiting_human_auth");
    expect(["expired", "invalid", "revoked"]).toContain(
      readiness.checks.humanAuthorization,
    );
    expect(readiness.activationAllowed).toBe(false);
  });

  it("compose le transport uniquement pour un futur manifeste explicitement ready", async () => {
    const prepared = getPreparedChannelProvider("whatsapp_twilio", environment);
    const readyManifest = channelAdapterManifestSchema.parse({
      ...prepared,
      state: "ready",
      transportEnabled: true,
    });
    const bootstrapKeyring = vi.fn().mockResolvedValue({
      activeKeyVersion: "managed-v2",
    } as ChannelProviderSecretKeyring);
    const resolveCredentials = vi.fn();
    const resolveDestination = vi.fn();
    const createSecretResolvers = vi.fn(() => ({
      resolveCredentials,
      resolveDestination,
    }));
    const createClient = vi.fn();
    const createClientFactory = vi.fn(() => createClient);
    const result = await composeWhatsAppTwilioActivation(
      {
        tenantId,
        manifest: readyManifest,
        environment,
        endpoint,
        authorizationId: authorization.authorizationId,
        now,
      },
      {
        loadAuthorization: vi.fn().mockResolvedValue(authorization),
        bootstrapKeyring,
        secretManager: { resolveSecret: vi.fn() },
        createSecretResolvers,
        createClientFactory,
      },
    );

    expect(result.readiness).toMatchObject({
      state: "ready",
      activationAllowed: true,
    });
    expect(result.transport).not.toBeNull();
    expect(bootstrapKeyring).toHaveBeenCalledOnce();
    expect(createSecretResolvers).toHaveBeenCalledOnce();
    expect(createClientFactory).toHaveBeenCalledOnce();
    expect(resolveCredentials).not.toHaveBeenCalled();
    expect(resolveDestination).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });
});

function blockedDependencies() {
  return {
    loadAuthorization: vi.fn().mockResolvedValue(authorization),
    bootstrapKeyring:
      vi.fn<WhatsAppTwilioActivationDependencies["bootstrapKeyring"]>(),
    secretManager: {
      resolveSecret:
        vi.fn<
          WhatsAppTwilioActivationDependencies["secretManager"]["resolveSecret"]
        >(),
    },
    createSecretResolvers:
      vi.fn<WhatsAppTwilioActivationDependencies["createSecretResolvers"]>(),
    createClientFactory:
      vi.fn<WhatsAppTwilioActivationDependencies["createClientFactory"]>(),
  } satisfies WhatsAppTwilioActivationDependencies;
}

function expectNoActivation(dependencies: ReturnType<typeof blockedDependencies>) {
  expect(dependencies.bootstrapKeyring).not.toHaveBeenCalled();
  expect(dependencies.secretManager.resolveSecret).not.toHaveBeenCalled();
  expect(dependencies.createSecretResolvers).not.toHaveBeenCalled();
  expect(dependencies.createClientFactory).not.toHaveBeenCalled();
}
