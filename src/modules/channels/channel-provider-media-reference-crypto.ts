import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";

const boundedIdentifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const keyVersionSchema = boundedIdentifierSchema.max(80);
const keyMaterialSchema = z.string().min(32).max(4_096);
const providerReferenceSchema = z
  .object({
    provider: z.literal("whatsapp_meta"),
    mediaId: z.string().regex(/^\d{1,64}$/),
    mediaKind: z.enum(["image", "audio", "document", "video", "sticker"]),
    declaredMediaType: z.string().min(3).max(120),
    declaredChecksumSha256: z.string().regex(/^[A-Fa-f0-9]{64}$/),
    originalFileName: z.string().min(1).max(255).nullable(),
  })
  .strict();
const contextSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    endpointId: boundedIdentifierSchema,
    messageId: boundedIdentifierSchema,
    provider: z.literal("whatsapp_meta"),
  })
  .strict();
const encryptedEnvelopeSchema = z
  .object({
    v: z.literal(1),
    alg: z.literal("aes-256-gcm"),
    iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
    tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    ciphertext: z.string().min(1).max(12_000).regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

export type ChannelProviderMediaReference = z.infer<
  typeof providerReferenceSchema
>;
export type ChannelProviderMediaReferenceContext = z.infer<
  typeof contextSchema
>;

export type ChannelProviderMediaReferenceCipher = {
  readonly keyVersion: string;
  encrypt(
    reference: ChannelProviderMediaReference,
    context: ChannelProviderMediaReferenceContext,
  ): string;
  decrypt(
    encryptedReference: string,
    context: ChannelProviderMediaReferenceContext,
  ): ChannelProviderMediaReference;
};

export class ChannelProviderMediaReferenceEncryptionError extends Error {
  readonly code = "media_reference_encryption_failed" as const;

  constructor() {
    super("La référence média fournisseur ne peut pas être protégée.");
    this.name = "ChannelProviderMediaReferenceEncryptionError";
  }
}

/**
 * Chiffre une référence fournisseur éphémère avec un contexte tenant/message
 * authentifié. Le contenu n'est jamais journalisé ni renvoyé par le service.
 */
export function createChannelProviderMediaReferenceCipher(input: {
  keyMaterial: string;
  keyVersion: string;
}): ChannelProviderMediaReferenceCipher {
  try {
    const keyVersion = keyVersionSchema.parse(input.keyVersion);
    const key = deriveKey(keyMaterialSchema.parse(input.keyMaterial), keyVersion);
    return {
      keyVersion,
      encrypt(reference, context) {
        try {
          const parsedReference = providerReferenceSchema.parse(reference);
          const parsedContext = contextSchema.parse(context);
          const iv = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", key, iv);
          cipher.setAAD(Buffer.from(associatedData(parsedContext), "utf8"));
          const ciphertext = Buffer.concat([
            cipher.update(JSON.stringify(parsedReference), "utf8"),
            cipher.final(),
          ]);
          return JSON.stringify(
            encryptedEnvelopeSchema.parse({
              v: 1,
              alg: "aes-256-gcm",
              iv: iv.toString("base64url"),
              tag: cipher.getAuthTag().toString("base64url"),
              ciphertext: ciphertext.toString("base64url"),
            }),
          );
        } catch {
          throw encryptionError();
        }
      },
      decrypt(encryptedReference, context) {
        try {
          const parsedContext = contextSchema.parse(context);
          const envelope = encryptedEnvelopeSchema.parse(
            JSON.parse(encryptedReference),
          );
          const decipher = createDecipheriv(
            "aes-256-gcm",
            key,
            Buffer.from(envelope.iv, "base64url"),
          );
          decipher.setAAD(Buffer.from(associatedData(parsedContext), "utf8"));
          decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
          return providerReferenceSchema.parse(
            JSON.parse(
              Buffer.concat([
                decipher.update(
                  Buffer.from(envelope.ciphertext, "base64url"),
                ),
                decipher.final(),
              ]).toString("utf8"),
            ),
          );
        } catch {
          throw encryptionError();
        }
      },
    };
  } catch {
    throw encryptionError();
  }
}

function associatedData(context: ChannelProviderMediaReferenceContext) {
  return JSON.stringify([
    "tradikom-channel-media-reference-v1",
    context.tenantId,
    context.provider,
    context.endpointId,
    context.messageId,
  ]);
}

function deriveKey(keyMaterial: string, keyVersion: string) {
  return createHash("sha256")
    .update("tradikom-channel-media-reference-key-v1", "utf8")
    .update("\0", "utf8")
    .update(keyVersion, "utf8")
    .update("\0", "utf8")
    .update(keyMaterial, "utf8")
    .digest();
}

function encryptionError() {
  return new ChannelProviderMediaReferenceEncryptionError();
}
