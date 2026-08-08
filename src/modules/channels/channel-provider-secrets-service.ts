import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  withSystemDbTransaction,
  withTenantDbTransaction,
} from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { hashToken, id, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import type { ChannelProviderSecretKeyring } from "@/modules/channels/channel-provider-secrets-crypto";
import { ChannelProviderSecretError } from "@/modules/channels/channel-provider-secrets-errors";
import {
  findActiveEndpointSecretVersion,
  findActiveIdentitySecretVersion,
  findActiveWhatsAppIdentity,
  findSecretVersionByRotationKey,
  findWhatsAppIdentity,
  insertSecretVersion,
  lockActiveWhatsAppEndpoint,
  lockWhatsAppEndpoint,
  nextSecretVersion,
  revokeActiveSecretVersions,
  type ChannelProviderSecretScope,
  type ChannelProviderSecretVersionRow,
} from "@/modules/channels/channel-provider-secrets-repository";
import type {
  WhatsAppTwilioCredentialsReference,
  WhatsAppTwilioDestinationReference,
  WhatsAppTwilioResolvedCredentials,
  WhatsAppTwilioResolvedDestination,
} from "@/modules/channels/whatsapp-twilio-transport";
import { assertTenantAccess } from "@/modules/tenants";

const boundedIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const rotationKeySchema = z.string().trim().min(8).max(256);
const accountSidSchema = z.string().regex(/^AC[a-fA-F0-9]{32}$/);
const authTokenSchema = z.string().min(1).max(512);
const whatsappAddressSchema = z
  .string()
  .trim()
  .regex(/^whatsapp:\+[1-9][0-9]{7,14}$/);

const endpointSecretSchema = z
  .object({
    accountSid: accountSidSchema,
    authToken: authTokenSchema,
    senderAddress: whatsappAddressSchema,
  })
  .strict();
const identitySecretSchema = z
  .object({ recipientAddress: whatsappAddressSchema })
  .strict();
const baseRotationSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    actorId: boundedIdentifierSchema,
    endpointId: boundedIdentifierSchema,
    rotationKey: rotationKeySchema,
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
const endpointRotationSchema = baseRotationSchema.extend({
  secret: endpointSecretSchema,
});
const identityRotationSchema = baseRotationSchema.extend({
  channelIdentityId: boundedIdentifierSchema,
  secret: identitySecretSchema,
});
const revokeSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    actorId: boundedIdentifierSchema,
    endpointId: boundedIdentifierSchema,
    channelIdentityId: boundedIdentifierSchema.nullable(),
    scope: z.enum(["endpoint", "identity"]),
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.scope === "endpoint" && value.channelIdentityId !== null) ||
      (value.scope === "identity" && value.channelIdentityId === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La référence du coffre ne correspond pas à sa portée.",
      });
    }
  });

const administratorRoles = ["owner", "administrator"] as const;

export async function rotateWhatsAppEndpointSecret(
  db: DbClient,
  input: z.input<typeof endpointRotationSchema>,
  keyring: ChannelProviderSecretKeyring,
) {
  const parsed = endpointRotationSchema.parse(input);
  return rotateSecret(
    db,
    {
      ...parsed,
      channelIdentityId: null,
      scope: "endpoint",
      plaintext: JSON.stringify(parsed.secret),
      expectedExternalAccountId: parsed.secret.accountSid,
    },
    keyring,
  );
}

export async function rotateWhatsAppIdentitySecret(
  db: DbClient,
  input: z.input<typeof identityRotationSchema>,
  keyring: ChannelProviderSecretKeyring,
) {
  const parsed = identityRotationSchema.parse(input);
  return rotateSecret(
    db,
    {
      ...parsed,
      scope: "identity",
      plaintext: JSON.stringify(parsed.secret),
    },
    keyring,
  );
}

export async function revokeWhatsAppEndpointSecret(
  db: DbClient,
  input: Omit<z.input<typeof revokeSchema>, "scope" | "channelIdentityId">,
) {
  return revokeSecret(db, {
    ...input,
    scope: "endpoint",
    channelIdentityId: null,
  });
}

export async function revokeWhatsAppIdentitySecret(
  db: DbClient,
  input: Omit<z.input<typeof revokeSchema>, "scope" | "channelIdentityId"> & {
    channelIdentityId: string;
  },
) {
  return revokeSecret(db, { ...input, scope: "identity" });
}

export function createWhatsAppTwilioSecretResolvers(
  db: DbClient,
  keyring: ChannelProviderSecretKeyring,
) {
  return {
    async resolveCredentials(
      reference: WhatsAppTwilioCredentialsReference,
    ): Promise<WhatsAppTwilioResolvedCredentials | null> {
      const parsed = credentialReferenceSchema.parse(reference);
      return withSystemDbTransaction(db, async (transaction) => {
        const row = await findActiveEndpointSecretVersion(
          transaction,
          parsed.tenantId,
          parsed.endpointId,
        );
        if (!row) return null;
        const secret = decryptSecret(row, keyring, endpointSecretSchema);
        return {
          accountSid: secret.accountSid,
          authToken: secret.authToken,
        };
      });
    },
    async resolveDestination(
      reference: WhatsAppTwilioDestinationReference,
    ): Promise<WhatsAppTwilioResolvedDestination | null> {
      const parsed = destinationReferenceSchema.parse(reference);
      return withSystemDbTransaction(db, async (transaction) => {
        const [endpointRow, identityRow] = await Promise.all([
          findActiveEndpointSecretVersion(
            transaction,
            parsed.tenantId,
            parsed.endpointId,
          ),
          findActiveIdentitySecretVersion(
            transaction,
            parsed.tenantId,
            parsed.endpointId,
            parsed.channelIdentityId,
          ),
        ]);
        if (!endpointRow || !identityRow) return null;
        const endpoint = decryptSecret(
          endpointRow,
          keyring,
          endpointSecretSchema,
        );
        const identity = decryptSecret(
          identityRow,
          keyring,
          identitySecretSchema,
        );
        return {
          senderAddress: endpoint.senderAddress,
          recipientAddress: identity.recipientAddress,
        };
      });
    },
  };
}

const credentialReferenceSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    endpointId: boundedIdentifierSchema,
  })
  .strict();
const destinationReferenceSchema = credentialReferenceSchema.extend({
  channelIdentityId: boundedIdentifierSchema,
});

async function rotateSecret(
  db: DbClient,
  input: {
    tenantId: string;
    actorId: string;
    endpointId: string;
    channelIdentityId: string | null;
    scope: ChannelProviderSecretScope;
    rotationKey: string;
    occurredAt?: string;
    plaintext: string;
    expectedExternalAccountId?: string;
  },
  keyring: ChannelProviderSecretKeyring,
) {
  return withTenantDbTransaction(
    db,
    input.tenantId,
    input.actorId,
    async (transaction) => {
      await assertAdministrator(transaction, input.actorId, input.tenantId);
      const rotationKeyHash = hashToken(
        `channel-provider-secret:v1:${input.rotationKey}`,
      );
      const replay = await findSecretVersionByRotationKey(
        transaction,
        input.tenantId,
        rotationKeyHash,
      );
      if (replay) {
        assertReplayReference(replay, input);
        assertReplayPayload(replay, input.plaintext, keyring);
        return rotationResult(replay, true);
      }

      const endpoint = await lockActiveWhatsAppEndpoint(
        transaction,
        input.tenantId,
        input.endpointId,
      );
      if (!endpoint) throw referenceError();
      if (
        input.expectedExternalAccountId &&
        endpoint.external_account_id !== input.expectedExternalAccountId
      ) {
        throw referenceError();
      }
      if (
        input.scope === "identity" &&
        (!input.channelIdentityId ||
          !(await findActiveWhatsAppIdentity(
            transaction,
            input.tenantId,
            input.channelIdentityId,
          )))
      ) {
        throw referenceError();
      }

      const secretVersion = await nextSecretVersion(transaction, input);
      const context = secretContext(input, secretVersion);
      const encrypted = keyring.encrypt(input.plaintext, context);
      const occurredAt = input.occurredAt ?? nowIso();
      await revokeActiveSecretVersions(transaction, {
        ...input,
        revokedAt: occurredAt,
      });
      const row = await insertSecretVersion(transaction, {
        id: id("channel_secret"),
        tenant_id: input.tenantId,
        endpoint_id: input.endpointId,
        channel_identity_id: input.channelIdentityId,
        secret_scope: input.scope,
        encrypted_payload: encrypted.encryptedPayload,
        key_version: encrypted.keyVersion,
        secret_version: secretVersion,
        rotation_key_hash: rotationKeyHash,
        created_by: input.actorId,
        created_at: occurredAt,
      });
      if (!row) throw cryptoError();
      await recordAuditLog(transaction, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: "channel.provider_secret_rotated",
        targetType: "channel_provider_secret_version",
        targetId: row.id,
        metadata: {
          provider: "whatsapp_twilio",
          scope: input.scope,
          secretVersion,
          keyVersion: encrypted.keyVersion,
          sensitiveValueRecorded: false,
        },
      });
      return rotationResult(row, false);
    },
  );
}

async function revokeSecret(
  db: DbClient,
  input: z.input<typeof revokeSchema>,
) {
  const parsed = revokeSchema.parse(input);
  return withTenantDbTransaction(
    db,
    parsed.tenantId,
    parsed.actorId,
    async (transaction) => {
      await assertAdministrator(transaction, parsed.actorId, parsed.tenantId);
      if (
        !(await lockWhatsAppEndpoint(
          transaction,
          parsed.tenantId,
          parsed.endpointId,
        ))
      ) {
        throw referenceError();
      }
      if (
        parsed.scope === "identity" &&
        parsed.channelIdentityId &&
        !(await findWhatsAppIdentity(
          transaction,
          parsed.tenantId,
          parsed.channelIdentityId,
        ))
      ) {
        throw referenceError();
      }
      const revoked = await revokeActiveSecretVersions(transaction, {
        ...parsed,
        revokedAt: parsed.occurredAt ?? nowIso(),
      });
      if (revoked.length > 0) {
        await recordAuditLog(transaction, {
          tenantId: parsed.tenantId,
          actorId: parsed.actorId,
          action: "channel.provider_secret_revoked",
          targetType: "channel_provider_endpoint",
          targetId: parsed.endpointId,
          metadata: {
            provider: "whatsapp_twilio",
            scope: parsed.scope,
            revokedCount: revoked.length,
            sensitiveValueRecorded: false,
          },
        });
      }
      return { revoked: revoked.length > 0, replayed: revoked.length === 0 };
    },
  );
}

async function assertAdministrator(
  db: DbClient,
  actorId: string,
  tenantId: string,
) {
  try {
    await assertTenantAccess(db, actorId, tenantId, [...administratorRoles]);
  } catch {
    throw new ChannelProviderSecretError(
      "channel_provider_secret_access_denied",
      "Accès refusé à la configuration du coffre fournisseur.",
    );
  }
}

function decryptSecret<T extends z.ZodTypeAny>(
  row: ChannelProviderSecretVersionRow,
  keyring: ChannelProviderSecretKeyring,
  schema: T,
): z.output<T> {
  try {
    const plaintext = keyring.decrypt(
      row.encrypted_payload,
      row.key_version,
      secretContext(
        {
          tenantId: row.tenant_id,
          endpointId: row.endpoint_id,
          channelIdentityId: row.channel_identity_id,
          scope: row.secret_scope,
        },
        row.secret_version,
      ),
    );
    return schema.parse(JSON.parse(plaintext));
  } catch {
    throw cryptoError();
  }
}

function secretContext(
  input: {
    tenantId: string;
    endpointId: string;
    channelIdentityId: string | null;
    scope: ChannelProviderSecretScope;
  },
  secretVersion: number,
) {
  return {
    tenantId: input.tenantId,
    provider: "whatsapp_twilio" as const,
    endpointId: input.endpointId,
    channelIdentityId: input.channelIdentityId,
    scope: input.scope,
    secretVersion,
  };
}

function assertReplayReference(
  row: ChannelProviderSecretVersionRow,
  input: {
    endpointId: string;
    channelIdentityId: string | null;
    scope: ChannelProviderSecretScope;
  },
) {
  if (
    row.endpoint_id !== input.endpointId ||
    row.channel_identity_id !== input.channelIdentityId ||
    row.secret_scope !== input.scope
  ) {
    throw referenceError();
  }
}

function assertReplayPayload(
  row: ChannelProviderSecretVersionRow,
  plaintext: string,
  keyring: ChannelProviderSecretKeyring,
) {
  let existing: string;
  try {
    existing = keyring.decrypt(
      row.encrypted_payload,
      row.key_version,
      secretContext(
        {
          tenantId: row.tenant_id,
          endpointId: row.endpoint_id,
          channelIdentityId: row.channel_identity_id,
          scope: row.secret_scope,
        },
        row.secret_version,
      ),
    );
  } catch {
    throw cryptoError();
  }
  const expected = Buffer.from(existing, "utf8");
  const candidate = Buffer.from(plaintext, "utf8");
  if (
    expected.length !== candidate.length ||
    !timingSafeEqual(expected, candidate)
  ) {
    throw new ChannelProviderSecretError(
      "channel_provider_secret_idempotency_conflict",
      "Cette clé de rotation correspond déjà à une autre configuration.",
    );
  }
}

function rotationResult(row: ChannelProviderSecretVersionRow, replayed: boolean) {
  return {
    secretVersionId: row.id,
    secretVersion: row.secret_version,
    version: row.secret_version,
    keyVersion: row.key_version,
    active: row.revoked_at === null,
    state: row.revoked_at === null ? ("active" as const) : ("revoked" as const),
    scope: row.secret_scope,
    replayed,
  };
}

function referenceError() {
  return new ChannelProviderSecretError(
    "channel_provider_secret_reference_invalid",
    "La référence du coffre fournisseur est invalide.",
  );
}

function cryptoError() {
  return new ChannelProviderSecretError(
    "channel_provider_secret_crypto_failed",
    "Le coffre fournisseur ne peut pas résoudre cette configuration.",
  );
}
