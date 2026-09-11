import { z } from "zod";
import {
  withSystemDbTransaction,
  withTenantDbTransaction,
} from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { hashToken, id, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { WhatsAppTwilioActivationAuthorizationError } from "@/modules/channels/whatsapp-twilio-activation-authorization-errors";
import {
  findWhatsAppActivationAuthorizationByIdempotencyKey,
  findWhatsAppActivationAuthorizationById,
  findWhatsAppActivationAuthorizationByReference,
  insertWhatsAppActivationAuthorization,
  lockActiveWhatsAppEndpointForAuthorization,
  revokeWhatsAppActivationAuthorizationRow,
  type WhatsAppTwilioActivationAuthorizationRow,
} from "@/modules/channels/whatsapp-twilio-activation-authorization-repository";
import { assertTenantAccess } from "@/modules/tenants";

const boundedIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const idempotencyKeySchema = z.string().trim().min(8).max(256);
const timestampSchema = z.string().datetime({ offset: true });
const issueSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    actorId: boundedIdentifierSchema,
    endpointId: boundedIdentifierSchema,
    idempotencyKey: idempotencyKeySchema,
    maxMessages: z.number().int().min(1).max(2),
    freeUnitsConfirmed: z.literal(true),
    expiresAt: timestampSchema,
    occurredAt: timestampSchema.optional(),
  })
  .strict();
const revokeSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    actorId: boundedIdentifierSchema,
    authorizationId: boundedIdentifierSchema,
    occurredAt: timestampSchema.optional(),
  })
  .strict();
const loadSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    endpointId: boundedIdentifierSchema,
    authorizationId: boundedIdentifierSchema,
  })
  .strict();

const administratorRoles = ["owner", "administrator"] as const;

export type WhatsAppTwilioStoredActivationAuthorization = {
  authorizationId: string;
  tenantId: string;
  endpointId: string;
  provider: "whatsapp_twilio";
  scope: "twilio_whatsapp_sandbox";
  maxMessages: number;
  freeUnitsConfirmed: true;
  authorizedBy: string;
  authorizedAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type WhatsAppTwilioActivationAuthorizationLoader = (input: {
  tenantId: string;
  endpointId: string;
  authorizationId: string;
}) => Promise<WhatsAppTwilioStoredActivationAuthorization | null>;

export async function issueWhatsAppTwilioActivationAuthorization(
  db: DbClient,
  input: z.input<typeof issueSchema>,
) {
  const parsed = issueSchema.parse(input);
  const authorizedAt = normalizeTimestamp(parsed.occurredAt ?? nowIso());
  const expiresAt = normalizeTimestamp(parsed.expiresAt);
  if (Date.parse(expiresAt) <= Date.parse(authorizedAt)) {
    throw invalidAuthorization();
  }

  return withTenantDbTransaction(
    db,
    parsed.tenantId,
    parsed.actorId,
    async (transaction) => {
      await assertAdministrator(transaction, parsed.actorId, parsed.tenantId);
      const idempotencyKeyHash = hashToken(
        `channel-provider-activation-authorization:v1:${parsed.idempotencyKey}`,
      );
      const replay = await findWhatsAppActivationAuthorizationByIdempotencyKey(
        transaction,
        parsed.tenantId,
        idempotencyKeyHash,
      );
      if (replay) {
        assertReplay(replay, {
          endpointId: parsed.endpointId,
          actorId: parsed.actorId,
          maxMessages: parsed.maxMessages,
          freeUnitsConfirmed: parsed.freeUnitsConfirmed,
          expiresAt,
        });
        return authorizationResult(replay, true);
      }

      if (
        !(await lockActiveWhatsAppEndpointForAuthorization(
          transaction,
          parsed.tenantId,
          parsed.endpointId,
        ))
      ) {
        throw invalidAuthorization();
      }

      const row = await insertWhatsAppActivationAuthorization(transaction, {
        id: id("channel_activation_authorization"),
        tenant_id: parsed.tenantId,
        endpoint_id: parsed.endpointId,
        max_messages: parsed.maxMessages,
        free_units_confirmed: parsed.freeUnitsConfirmed,
        idempotency_key_hash: idempotencyKeyHash,
        authorized_by: parsed.actorId,
        authorized_at: authorizedAt,
        expires_at: expiresAt,
      });
      if (!row) {
        const concurrent =
          await findWhatsAppActivationAuthorizationByIdempotencyKey(
            transaction,
            parsed.tenantId,
            idempotencyKeyHash,
          );
        if (!concurrent) throw invalidAuthorization();
        assertReplay(concurrent, {
          endpointId: parsed.endpointId,
          actorId: parsed.actorId,
          maxMessages: parsed.maxMessages,
          freeUnitsConfirmed: parsed.freeUnitsConfirmed,
          expiresAt,
        });
        return authorizationResult(concurrent, true);
      }

      await recordAuditLog(transaction, {
        tenantId: parsed.tenantId,
        actorId: parsed.actorId,
        action: "channel.provider_activation_authorized",
        targetType: "channel_provider_activation_authorization",
        targetId: row.id,
        metadata: {
          provider: "whatsapp_twilio",
          scope: "twilio_whatsapp_sandbox",
          maxMessages: row.max_messages,
          freeUnitsConfirmed: true,
          sensitiveValueRecorded: false,
        },
      });
      return authorizationResult(row, false);
    },
  );
}

export async function revokeWhatsAppTwilioActivationAuthorization(
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
      const existing = await findWhatsAppActivationAuthorizationById(
        transaction,
        parsed.tenantId,
        parsed.authorizationId,
      );
      if (!existing) throw authorizationNotFound();
      if (existing.revoked_at) {
        return { authorizationId: existing.id, revoked: false, replayed: true };
      }

      const revocationTime = normalizeTimestamp(parsed.occurredAt ?? nowIso());
      if (Date.parse(revocationTime) < Date.parse(existing.authorized_at)) {
        throw invalidAuthorization();
      }

      const revoked = await revokeWhatsAppActivationAuthorizationRow(
        transaction,
        {
          tenantId: parsed.tenantId,
          authorizationId: parsed.authorizationId,
          actorId: parsed.actorId,
          revokedAt: revocationTime,
        },
      );
      if (!revoked) {
        return { authorizationId: existing.id, revoked: false, replayed: true };
      }
      await recordAuditLog(transaction, {
        tenantId: parsed.tenantId,
        actorId: parsed.actorId,
        action: "channel.provider_activation_revoked",
        targetType: "channel_provider_activation_authorization",
        targetId: revoked.id,
        metadata: {
          provider: "whatsapp_twilio",
          scope: "twilio_whatsapp_sandbox",
          sensitiveValueRecorded: false,
        },
      });
      return { authorizationId: revoked.id, revoked: true, replayed: false };
    },
  );
}

export function createWhatsAppTwilioActivationAuthorizationLoader(
  db: DbClient,
): WhatsAppTwilioActivationAuthorizationLoader {
  return async (input) => {
    const parsed = loadSchema.parse(input);
    return withSystemDbTransaction(db, async (transaction) => {
      const row = await findWhatsAppActivationAuthorizationByReference(
        transaction,
        parsed,
      );
      return row ? mapStoredAuthorization(row) : null;
    });
  };
}

async function assertAdministrator(
  db: DbClient,
  actorId: string,
  tenantId: string,
) {
  try {
    await assertTenantAccess(db, actorId, tenantId, [...administratorRoles]);
  } catch {
    throw new WhatsAppTwilioActivationAuthorizationError(
      "channel_provider_activation_authorization_access_denied",
      "Accès refusé à l'autorisation d'activation du canal.",
    );
  }
}

function assertReplay(
  row: WhatsAppTwilioActivationAuthorizationRow,
  input: {
    endpointId: string;
    actorId: string;
    maxMessages: number;
    freeUnitsConfirmed: true;
    expiresAt: string;
  },
) {
  if (
    row.endpoint_id !== input.endpointId ||
    row.authorized_by !== input.actorId ||
    row.max_messages !== input.maxMessages ||
    row.free_units_confirmed !== input.freeUnitsConfirmed ||
    row.expires_at !== input.expiresAt
  ) {
    throw new WhatsAppTwilioActivationAuthorizationError(
      "channel_provider_activation_authorization_idempotency_conflict",
      "La clé d'idempotence correspond à une autre autorisation.",
    );
  }
}

function authorizationResult(
  row: WhatsAppTwilioActivationAuthorizationRow,
  replayed: boolean,
) {
  return {
    authorizationId: row.id,
    endpointId: row.endpoint_id,
    scope: row.authorization_scope,
    maxMessages: row.max_messages,
    expiresAt: row.expires_at,
    revoked: row.revoked_at !== null,
    replayed,
  };
}

function mapStoredAuthorization(
  row: WhatsAppTwilioActivationAuthorizationRow,
): WhatsAppTwilioStoredActivationAuthorization {
  return {
    authorizationId: row.id,
    tenantId: row.tenant_id,
    endpointId: row.endpoint_id,
    provider: row.provider,
    scope: row.authorization_scope,
    maxMessages: row.max_messages,
    freeUnitsConfirmed: true,
    authorizedBy: row.authorized_by,
    authorizedAt: row.authorized_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

function normalizeTimestamp(value: string) {
  return new Date(value).toISOString();
}

function invalidAuthorization() {
  return new WhatsAppTwilioActivationAuthorizationError(
    "channel_provider_activation_authorization_invalid",
    "L'autorisation d'activation est invalide.",
  );
}

function authorizationNotFound() {
  return new WhatsAppTwilioActivationAuthorizationError(
    "channel_provider_activation_authorization_not_found",
    "Autorisation d'activation introuvable.",
  );
}
