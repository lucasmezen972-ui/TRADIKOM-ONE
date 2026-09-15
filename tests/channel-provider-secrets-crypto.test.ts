import { describe, expect, it } from "vitest";
import {
  ChannelProviderSecretError,
  createChannelProviderSecretKeyring,
  type ChannelProviderSecretContext,
} from "../src/modules/channels";

const context: ChannelProviderSecretContext = {
  tenantId: "tenant_crypto",
  provider: "whatsapp_twilio",
  endpointId: "endpoint_crypto",
  channelIdentityId: null,
  scope: "endpoint",
  secretVersion: 1,
};

describe("chiffrement du coffre fournisseur", () => {
  it("chiffre avec AES-256-GCM et ne révèle pas la valeur claire", () => {
    const keyring = createKeyring();
    const plaintext = JSON.stringify({ authToken: "secret-test-only" });
    const encrypted = keyring.encrypt(plaintext, context);

    expect(encrypted.keyVersion).toBe("test-v1");
    expect(encrypted.encryptedPayload).not.toContain("secret-test-only");
    expect(JSON.parse(encrypted.encryptedPayload)).toMatchObject({
      v: 1,
      alg: "aes-256-gcm",
    });
    expect(
      keyring.decrypt(encrypted.encryptedPayload, encrypted.keyVersion, context),
    ).toBe(plaintext);
  });

  it("refuse un ciphertext altéré, un contexte déplacé et une clé absente", () => {
    const keyring = createKeyring();
    const encrypted = keyring.encrypt("valeur", context);
    const envelope = JSON.parse(encrypted.encryptedPayload) as {
      ciphertext: string;
    };
    const replacement = envelope.ciphertext.endsWith("A") ? "B" : "A";
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}${replacement}`;

    for (const operation of [
      () => keyring.decrypt(JSON.stringify(envelope), "test-v1", context),
      () =>
        keyring.decrypt(encrypted.encryptedPayload, "test-v1", {
          ...context,
          tenantId: "tenant_autre",
        }),
      () => keyring.decrypt(encrypted.encryptedPayload, "missing-v2", context),
    ]) {
      expect(operation).toThrow(
        expect.objectContaining({
          code: "channel_provider_secret_crypto_failed",
        }) as ChannelProviderSecretError,
      );
    }
  });

  it("exige une clé exacte de 256 bits et une version active existante", () => {
    expect(() =>
      createChannelProviderSecretKeyring({
        activeKeyVersion: "test-v1",
        keys: { "test-v1": new Uint8Array(31) },
      }),
    ).toThrow(/coffre fournisseur/i);
    expect(() =>
      createChannelProviderSecretKeyring({
        activeKeyVersion: "missing-v2",
        keys: { "test-v1": new Uint8Array(32) },
      }),
    ).toThrow(/coffre fournisseur/i);
  });
});

function createKeyring() {
  return createChannelProviderSecretKeyring({
    activeKeyVersion: "test-v1",
    keys: { "test-v1": Buffer.alloc(32, 7) },
  });
}
