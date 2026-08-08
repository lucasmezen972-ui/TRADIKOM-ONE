import { z } from "zod";
import { createChannelProviderSecretKeyring } from "@/modules/channels/channel-provider-secrets-crypto";
import { ChannelProviderSecretError } from "@/modules/channels/channel-provider-secrets-errors";

const activeKeyVersionVariable =
  "CHANNEL_PROVIDER_SECRET_ACTIVE_KEY_VERSION" as const;
const keyReferencesVariable =
  "CHANNEL_PROVIDER_SECRET_KEY_REFERENCES" as const;
const keyVersionSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const secretReferenceSchema = z
  .string()
  .trim()
  .min(8)
  .max(512)
  .regex(/^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/);
const encodedKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const configurationSchema = z
  .object({
    activeKeyVersion: keyVersionSchema,
    keys: z
      .array(
        z
          .object({
            version: keyVersionSchema,
            reference: secretReferenceSchema,
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict()
  .superRefine((configuration, context) => {
    const versions = new Set<string>();
    const references = new Set<string>();
    for (const key of configuration.keys) {
      if (versions.has(key.version)) {
        context.addIssue({
          code: "custom",
          path: ["keys"],
          message: "Une version de clé ne peut être déclarée qu'une fois.",
        });
      }
      if (references.has(key.reference)) {
        context.addIssue({
          code: "custom",
          path: ["keys"],
          message: "Une référence de secret ne peut être réutilisée.",
        });
      }
      versions.add(key.version);
      references.add(key.reference);
    }
    if (!versions.has(configuration.activeKeyVersion)) {
      context.addIssue({
        code: "custom",
        path: ["activeKeyVersion"],
        message: "La version active doit avoir une référence gérée.",
      });
    }
  });

type Environment = Record<string, string | undefined>;

export type ChannelProviderSecretReferenceResolver = {
  resolveSecret(reference: string): string | null | Promise<string | null>;
};

export async function bootstrapChannelProviderSecretKeyring(input: {
  environment?: Environment;
  secretManager: ChannelProviderSecretReferenceResolver;
}) {
  assertServerRuntime();
  try {
    const configuration = parseConfiguration(input.environment ?? process.env);
    const keys: Record<string, Uint8Array> = {};
    for (const key of configuration.keys) {
      let encoded: string | null;
      try {
        encoded = await input.secretManager.resolveSecret(key.reference);
      } catch {
        throw bootstrapError();
      }
      if (!encoded) throw bootstrapError();
      keys[key.version] = decodeKey(encoded);
    }
    return createChannelProviderSecretKeyring({
      activeKeyVersion: configuration.activeKeyVersion,
      keys,
    });
  } catch (error) {
    if (error instanceof ChannelProviderSecretError) throw error;
    throw bootstrapError();
  }
}

function parseConfiguration(environment: Environment) {
  const activeKeyVersion = environment[activeKeyVersionVariable];
  const rawReferences = environment[keyReferencesVariable];
  if (!activeKeyVersion || !rawReferences) throw bootstrapError();
  try {
    return configurationSchema.parse({
      activeKeyVersion,
      keys: JSON.parse(rawReferences),
    });
  } catch {
    throw bootstrapError();
  }
}

function decodeKey(value: string) {
  const encoded = encodedKeySchema.safeParse(value);
  if (!encoded.success) throw bootstrapError();
  const key = Buffer.from(encoded.data, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encoded.data) {
    throw bootstrapError();
  }
  return key;
}

function assertServerRuntime() {
  if (typeof window !== "undefined") throw bootstrapError();
}

function bootstrapError() {
  return new ChannelProviderSecretError(
    "channel_provider_secret_not_configured",
    "Le coffre fournisseur n'est pas configuré sur ce serveur.",
  );
}
