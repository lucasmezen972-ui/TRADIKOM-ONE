import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import { ChannelProviderSecretError } from "@/modules/channels/channel-provider-secrets-errors";
import type { ChannelProviderSecretProvider } from "@/modules/channels/channel-provider-secrets-repository";

const keyVersionSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const encryptedEnvelopeSchema = z
  .object({
    v: z.literal(1),
    alg: z.literal("aes-256-gcm"),
    iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
    tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    ciphertext: z.string().min(1).max(12_000).regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

export type ChannelProviderSecretContext = {
  tenantId: string;
  provider: ChannelProviderSecretProvider;
  endpointId: string;
  channelIdentityId: string | null;
  scope: "endpoint" | "identity";
  secretVersion: number;
};

export type ChannelProviderSecretKeyring = {
  readonly activeKeyVersion: string;
  encrypt(
    plaintext: string,
    context: ChannelProviderSecretContext,
  ): { encryptedPayload: string; keyVersion: string };
  decrypt(
    encryptedPayload: string,
    keyVersion: string,
    context: ChannelProviderSecretContext,
  ): string;
};

export function createChannelProviderSecretKeyring(input: {
  activeKeyVersion: string;
  keys: Readonly<Record<string, Uint8Array>>;
}): ChannelProviderSecretKeyring {
  const activeKeyVersion = keyVersionSchema.parse(input.activeKeyVersion);
  const keys = new Map(
    Object.entries(input.keys).map(([version, value]) => [
      keyVersionSchema.parse(version),
      normalizeKey(value),
    ]),
  );
  if (!keys.has(activeKeyVersion)) {
    throw cryptoError();
  }

  return {
    activeKeyVersion,
    encrypt(plaintext, context) {
      try {
        const key = keys.get(activeKeyVersion);
        if (!key || plaintext.length < 1 || plaintext.length > 8_192) {
          throw cryptoError();
        }
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(Buffer.from(associatedData(context), "utf8"));
        const ciphertext = Buffer.concat([
          cipher.update(plaintext, "utf8"),
          cipher.final(),
        ]);
        const envelope = encryptedEnvelopeSchema.parse({
          v: 1,
          alg: "aes-256-gcm",
          iv: iv.toString("base64url"),
          tag: cipher.getAuthTag().toString("base64url"),
          ciphertext: ciphertext.toString("base64url"),
        });
        return {
          encryptedPayload: JSON.stringify(envelope),
          keyVersion: activeKeyVersion,
        };
      } catch (error) {
        if (error instanceof ChannelProviderSecretError) throw error;
        throw cryptoError();
      }
    },
    decrypt(encryptedPayload, keyVersion, context) {
      try {
        const parsedKeyVersion = keyVersionSchema.parse(keyVersion);
        const key = keys.get(parsedKeyVersion);
        if (!key) throw cryptoError();
        const envelope = encryptedEnvelopeSchema.parse(
          JSON.parse(encryptedPayload),
        );
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(envelope.iv, "base64url"),
        );
        decipher.setAAD(Buffer.from(associatedData(context), "utf8"));
        decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
        return Buffer.concat([
          decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8");
      } catch (error) {
        if (error instanceof ChannelProviderSecretError) throw error;
        throw cryptoError();
      }
    },
  };
}

function associatedData(context: ChannelProviderSecretContext) {
  return JSON.stringify([
    "tradikom-channel-secret-v1",
    context.tenantId,
    context.provider,
    context.endpointId,
    context.channelIdentityId,
    context.scope,
    context.secretVersion,
  ]);
}

function normalizeKey(value: Uint8Array) {
  const key = Buffer.from(value);
  if (key.length !== 32) throw cryptoError();
  return key;
}

function cryptoError() {
  return new ChannelProviderSecretError(
    "channel_provider_secret_crypto_failed",
    "Le coffre fournisseur ne peut pas résoudre cette configuration.",
  );
}
