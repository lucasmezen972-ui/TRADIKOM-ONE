import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapChannelProviderSecretKeyring,
  ChannelProviderSecretError,
} from "../src/modules/channels";

const activeVersion = "managed-v2";
const activeReference = "test-secret://channel-key/managed-v2";
const previousReference = "test-secret://channel-key/managed-v1";
const activeKey = Buffer.alloc(32, 7).toString("base64url");
const previousKey = Buffer.alloc(32, 5).toString("base64url");
const environment = {
  CHANNEL_PROVIDER_SECRET_ACTIVE_KEY_VERSION: activeVersion,
  CHANNEL_PROVIDER_SECRET_KEY_REFERENCES: JSON.stringify([
    { version: "managed-v1", reference: previousReference },
    { version: activeVersion, reference: activeReference },
  ]),
};
const context = {
  tenantId: "tenant_bootstrap",
  provider: "whatsapp_twilio" as const,
  endpointId: "endpoint_bootstrap",
  channelIdentityId: null,
  scope: "endpoint" as const,
  secretVersion: 1,
};

describe("bootstrap serveur du keyring fournisseur", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("résout des références versionnées et construit un keyring AES-256", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const resolveSecret = vi.fn(async (reference: string) =>
      reference === activeReference ? activeKey : previousKey,
    );
    const keyring = await bootstrapChannelProviderSecretKeyring({
      environment,
      secretManager: { resolveSecret },
    });
    const encrypted = keyring.encrypt("valeur éphémère", context);

    expect(keyring.activeKeyVersion).toBe(activeVersion);
    expect(resolveSecret.mock.calls).toEqual([
      [previousReference],
      [activeReference],
    ]);
    expect(
      keyring.decrypt(encrypted.encryptedPayload, encrypted.keyVersion, context),
    ).toBe("valeur éphémère");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuse le navigateur avant de résoudre une référence", async () => {
    const resolveSecret = vi.fn();
    vi.stubGlobal("window", {});

    await expect(
      bootstrapChannelProviderSecretKeyring({
        environment,
        secretManager: { resolveSecret },
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_secret_not_configured",
    });
    expect(resolveSecret).not.toHaveBeenCalled();
  });

  it.each([
    {},
    {
      ...environment,
      CHANNEL_PROVIDER_SECRET_ACTIVE_KEY_VERSION: "missing-v3",
    },
    {
      ...environment,
      CHANNEL_PROVIDER_SECRET_KEY_REFERENCES: JSON.stringify([
        { version: activeVersion, reference: activeReference },
        { version: activeVersion, reference: previousReference },
      ]),
    },
    {
      ...environment,
      CHANNEL_PROVIDER_SECRET_KEY_REFERENCES: JSON.stringify([
        { version: "managed-v1", reference: activeReference },
        { version: activeVersion, reference: activeReference },
      ]),
    },
  ])("refuse une configuration absente ou ambiguë", async (invalidEnvironment) => {
    const resolveSecret = vi.fn();
    await expect(
      bootstrapChannelProviderSecretKeyring({
        environment: invalidEnvironment,
        secretManager: { resolveSecret },
      }),
    ).rejects.toMatchObject({
      code: "channel_provider_secret_not_configured",
    });
    expect(resolveSecret).not.toHaveBeenCalled();
  });

  it.each([null, "not-a-256-bit-base64url-key"])(
    "échoue fermé sur une valeur gérée absente ou invalide",
    async (resolvedValue) => {
      const resolveSecret = vi.fn().mockResolvedValue(resolvedValue);
      await expect(
        bootstrapChannelProviderSecretKeyring({
          environment,
          secretManager: { resolveSecret },
        }),
      ).rejects.toMatchObject({
        code: "channel_provider_secret_not_configured",
      });
    },
  );

  it("ne propage ni référence ni erreur brute du gestionnaire de secrets", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rawDetail = "secret-manager-sensitive-detail";
    try {
      await bootstrapChannelProviderSecretKeyring({
        environment,
        secretManager: {
          resolveSecret(reference) {
            throw new ChannelProviderSecretError(
              "channel_provider_secret_crypto_failed",
              `${reference}:${rawDetail}`,
            );
          },
        },
      });
      throw new Error("Expected the bootstrap to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ChannelProviderSecretError);
      expect((error as Error).message).not.toContain(activeReference);
      expect((error as Error).message).not.toContain(previousReference);
      expect((error as Error).message).not.toContain(rawDetail);
    }
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
