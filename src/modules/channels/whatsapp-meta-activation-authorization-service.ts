import { z } from "zod";
import {
  withSystemDbTransaction,
  withTenantDbTransaction,
} from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { hashToken, id, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { WhatsAppMetaActivationAuthorizationError } from "@/modules/channels/whatsapp-meta-activation-authorization-errors";
import {
  findMetaWhatsAppAuthorizationById,
  findMetaWhatsAppAuthorizationByIdempotencyKey,
  findMetaWhatsAppAuthorizationByReference,
  findValidUnconsumedMetaWhatsAppTrialAuthorization,
  hasMetaWhatsAppTrialAuthorizationConsumption,
  insertMetaWhatsAppTrialAuthorization,
  lockActiveMetaWhatsAppEndpointForAuthorization,
  lockConfiguredMetaWhatsAppEndpointsForAuthorization,
  lockMetaWhatsAppEndpointsForAuthorizationRevocation,
  revokeMetaWhatsAppAuthorizationRow,
  revokeValidUnconsumedMetaWhatsAppTrialAuthorizationsForTenant,
  type WhatsAppMetaActivationAuthorizationRow,
} from "@/modules/channels/whatsapp-meta-activation-authorization-repository";
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
const currentIssueSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    actorId: boundedIdentifierSchema,
    idempotencyKey: idempotencyKeySchema,
    freeUnitsConfirmed: z.literal(true),
    validForSeconds: z.number().int().min(60).max(3_600).optional(),
    occurredAt: timestampSchema.optional(),
  })
  .strict();
const currentRevokeSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    actorId: boundedIdentifierSchema,
    occurredAt: timestampSchema.optional(),
  })
  .strict();

const administratorRoles = ["owner", "administrator"] as const;
const defaultTrialAuthorizationValiditySeconds = 15 * 60;

export type WhatsAppMetaStoredTrialAuthorization = {
  authorizationId: string;
  tenantId: string;
  endpointId: string;
  provider: "whatsapp_meta";
  scope: "meta_whatsapp_trial";
  maxMessages: 1;
  freeUnitsConfirmed: true;
  authorizedBy: string;
  authorizedAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type WhatsAppMetaTrialAuthorizationLoader = (input: {
  tenantId: string;
  endpointId: string;
  authorizationId: string;
}) => Promise<WhatsAppMetaStoredTrialAuthorization | null>;

export async function issueCurrentWhatsAppMetaTrialAuthorization(
  db: DbClient,
  input: z.input<typeof currentIssueSchema>,
) {
  const parsed = currentIssueSchema.parse(input);
  const authorizedAt = normalizeTimestamp(parsed.occurredAt ?? nowIso());
  const validForSeconds =
    parsed.validForSeconds ?? defaultTrialAuthorizationValiditySeconds;
  const expiresAt = new Date(
    Date.parse(authorizedAt) + validForSeconds * 1_000,
  ).toISOString();

  return withTenantDbTransaction(
    db,
    parsed.tenantId,
    parsed.actorId,
    async (transaction) => {
      await assertAdministrator(transaction, parsed.actorId, parsed.tenantId);
      const idempotencyKeyHash = hashMetaTrialAuthorizationKey(
        parsed.idempotencyKey,
      );
      const replay = await findMetaWhatsAppAuthorizationByIdempotencyKey(
        transaction,
        parsed.tenantId,
        idempotencyKeyHash,
      );
      if (replay) {
        assertCurrentReplay(replay, {
          actorId: parsed.actorId,
          freeUnitsConfirmed: parsed.freeUnitsConfirmed,
          validForSeconds,
        });
        return {
          ...authorizationResult(replay, true),
          reused: false,
        };
      }

      const endpointId = await lockSingleConfiguredMetaEndpoint(
        transaction,
        parsed.tenantId,
      );
      const concurrentReplay =
        await findMetaWhatsAppAuthorizationByIdempotencyKey(
          transaction,
          parsed.tenantId,
          idempotencyKeyHash,
        );
      if (concurrentReplay) {
        assertCurrentReplay(concurrentReplay, {
          actorId: parsed.actorId,
          freeUnitsConfirmed: parsed.freeUnitsConfirmed,
          validForSeconds,
        });
        return {
          ...authorizationResult(concurrentReplay, true),
          reused: false,
        };
      }

      if (
        await hasMetaWhatsAppTrialAuthorizationConsumption(
          transaction,
          parsed.tenantId,
          endpointId,
        )
      ) {
        throw invalidAuthorization();
      }

      const reusable =
        await findValidUnconsumedMetaWhatsAppTrialAuthorization(transaction, {
          tenantId: parsed.tenantId,
          endpointId,
          observedAt: authorizedAt,
        });
      if (reusable) {
        throw invalidAuthorization();
      }

      const row = await insertMetaWhatsAppTrialAuthorization(transaction, {
        id: id("channel_activation_authorization"),
        tenant_id: parsed.tenantId,
        endpoint_id: endpointId,
        free_units_confirmed: parsed.freeUnitsConfirmed,
        idempotency_key_hash: idempotencyKeyHash,
        authorized_by: parsed.actorId,
        authorized_at: authorizedAt,
        expires_at: expiresAt,
      });
      if (!row) {
        const concurrent = await findMetaWhatsAppAuthorizationByIdempotencyKey(
          transaction,
          parsed.tenantId,
          idempotencyKeyHash,
        );
        if (!concurrent) throw invalidAuthorization();
        assertCurrentReplay(concurrent, {
          actorId: parsed.actorId,
          freeUnitsConfirmed: parsed.freeUnitsConfirmed,
          validForSeconds,
        });
        return {
          ...authorizationResult(concurrent, true),
          reused: false,
        };
      }

      await recordAuthorizationIssuedAudit(
        transaction,
        parsed.tenantId,
        parsed.actorId,
        row.id,
      );
      return {
        ...authorizationResult(row, false),
        reused: false,
      };
    },
  );
}

export async function revokeCurrentWhatsAppMetaTrialAuthorization(
  db: DbClient,
  input: z.input<typeof currentRevokeSchema>,
) {
  const parsed = currentRevokeSchema.parse(input);
  const revokedAt = normalizeTimestamp(parsed.occurredAt ?? nowIso());
  return withTenantDbTransaction(
    db,
    parsed.tenantId,
    parsed.actorId,
    async (transaction) => {
      await assertAdministrator(transaction, parsed.actorId, parsed.tenantId);
      const endpoints =
        await lockMetaWhatsAppEndpointsForAuthorizationRevocation(
          transaction,
          parsed.tenantId,
        );
      const revoked =
        await revokeValidUnconsumedMetaWhatsAppTrialAuthorizationsForTenant(
          transaction,
          {
            tenantId: parsed.tenantId,
            actorId: parsed.actorId,
            revokedAt,
          },
        );
      for (const authorization of revoked) {
        await recordAuthorizationRevokedAudit(
          transaction,
          parsed.tenantId,
          parsed.actorId,
          authorization.id,
        );
      }
      const endpointId =
        revoked[0]?.endpoint_id ??
        (endpoints.length === 1 ? endpoints[0]?.id ?? null : null);
      return {
        endpointId,
        revokedCount: revoked.length,
        replayed: revoked.length === 0,
      };
    },
  );
}

export async function issueWhatsAppMetaTrialAuthorization(
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
      const idempotencyKeyHash = hashMetaTrialAuthorizationKey(
        parsed.idempotencyKey,
      );
      const replay = await findMetaWhatsAppAuthorizationByIdempotencyKey(
        transaction,
        parsed.tenantId,
        idempotencyKeyHash,
      );
      if (replay) {
        assertReplay(replay, {
          endpointId: parsed.endpointId,
          actorId: parsed.actorId,
          freeUnitsConfirmed: parsed.freeUnitsConfirmed,
          expiresAt,
        });
        return authorizationResult(replay, true);
      }

      if (
        !(await lockActiveMetaWhatsAppEndpointForAuthorization(
          transaction,
          parsed.tenantId,
          parsed.endpointId,
        ))
      ) {
        throw invalidAuthorization();
      }

      const row = await insertMetaWhatsAppTrialAuthorization(transaction, {
        id: id("channel_activation_authorization"),
        tenant_id: parsed.tenantId,
        endpoint_id: parsed.endpointId,
        free_units_confirmed: parsed.freeUnitsConfirmed,
        idempotency_key_hash: idempotencyKeyHash,
        authorized_by: parsed.actorId,
        authorized_at: authorizedAt,
        expires_at: expiresAt,
      });
      if (!row) {
        const concurrent = await findMetaWhatsAppAuthorizationByIdempotencyKey(
          transaction,
          parsed.tenantId,
          idempotencyKeyHash,
        );
        if (!concurrent) throw invalidAuthorization();
        assertReplay(concurrent, {
          endpointId: parsed.endpointId,
          actorId: parsed.actorId,
          freeUnitsConfirmed: parsed.freeUnitsConfirmed,
          expiresAt,
        });
        return authorizationResult(concurrent, true);
      }

      await recordAuthorizationIssuedAudit(
        transaction,
        parsed.tenantId,
        parsed.actorId,
        row.id,
      );
      return authorizationResult(row, false);
    },
  );
}

export async function revokeWhatsAppMetaTrialAuthorization(
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
      const existing = await findMetaWhatsAppAuthorizationById(
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

      const revoked = await revokeMetaWhatsAppAuthorizationRow(transaction, {
        tenantId: parsed.tenantId,
        authorizationId: parsed.authorizationId,
        actorId: parsed.actorId,
        revokedAt: revocationTime,
      });
      if (!revoked) {
        return { authorizationId: existing.id, revoked: false, replayed: true };
      }
      await recordAuthorizationRevokedAudit(
        transaction,
        parsed.tenantId,
        parsed.actorId,
        revoked.id,
      );
      return { authorizationId: revoked.id, revoked: true, replayed: false };
    },
  );
}

export function createWhatsAppMetaTrialAuthorizationLoader(
  db: DbClient,
): WhatsAppMetaTrialAuthorizationLoader {
  return async (input) => {
    const parsed = loadSchema.parse(input);
    return withSystemDbTransaction(db, async (transaction) => {
      const row = await findMetaWhatsAppAuthorizationByReference(
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
    throw new WhatsAppMetaActivationAuthorizationError(
      "channel_provider_activation_authorization_access_denied",
      "Accès refusé à l'autorisation d'essai WhatsApp Meta.",
    );
  }
}

async function lockSingleConfiguredMetaEndpoint(
  db: DbClient,
  tenantId: string,
) {
  const endpoints =
    await lockConfiguredMetaWhatsAppEndpointsForAuthorization(db, tenantId);
  if (endpoints.length !== 1 || !endpoints[0]) {
    throw invalidAuthorization();
  }
  return endpoints[0].id;
}

function assertCurrentReplay(
  row: WhatsAppMetaActivationAuthorizationRow,
  input: {
    actorId: string;
    freeUnitsConfirmed: true;
    validForSeconds: number;
  },
) {
  const storedValiditySeconds =
    (Date.parse(row.expires_at) - Date.parse(row.authorized_at)) / 1_000;
  if (
    row.authorized_by !== input.actorId ||
    row.max_messages !== 1 ||
    row.free_units_confirmed !== input.freeUnitsConfirmed ||
    storedValiditySeconds !== input.validForSeconds
  ) {
    throw new WhatsAppMetaActivationAuthorizationError(
      "channel_provider_activation_authorization_idempotency_conflict",
      "La clé d'idempotence correspond à une autre autorisation.",
    );
  }
}

function assertReplay(
  row: WhatsAppMetaActivationAuthorizationRow,
  input: {
    endpointId: string;
    actorId: string;
    freeUnitsConfirmed: true;
    expiresAt: string;
  },
) {
  if (
    row.endpoint_id !== input.endpointId ||
    row.authorized_by !== input.actorId ||
    row.max_messages !== 1 ||
    row.free_units_confirmed !== input.freeUnitsConfirmed ||
    row.expires_at !== input.expiresAt
  ) {
    throw new WhatsAppMetaActivationAuthorizationError(
      "channel_provider_activation_authorization_idempotency_conflict",
      "La clé d'idempotence correspond à une autre autorisation.",
    );
  }
}

function authorizationResult(
  row: WhatsAppMetaActivationAuthorizationRow,
  replayed: boolean,
) {
  return {
    authorizationId: row.id,
    endpointId: row.endpoint_id,
    scope: row.authorization_scope,
    maxMessages: 1 as const,
    expiresAt: row.expires_at,
    revoked: row.revoked_at !== null,
    replayed,
  };
}

function hashMetaTrialAuthorizationKey(idempotencyKey: string) {
  return hashToken(
    `channel-provider-activation-authorization:whatsapp-meta:v1:${idempotencyKey}`,
  );
}

async function recordAuthorizationIssuedAudit(
  db: DbClient,
  tenantId: string,
  actorId: string,
  authorizationId: string,
) {
  await recordAuditLog(db, {
    tenantId,
    actorId,
    action: "channel.provider_activation_authorized",
    targetType: "channel_provider_activation_authorization",
    targetId: authorizationId,
    metadata: {
      provider: "whatsapp_meta",
      scope: "meta_whatsapp_trial",
      maxMessages: 1,
      freeUnitsConfirmed: true,
      sensitiveValueRecorded: false,
    },
  });
}

async function recordAuthorizationRevokedAudit(
  db: DbClient,
  tenantId: string,
  actorId: string,
  authorizationId: string,
) {
  await recordAuditLog(db, {
    tenantId,
    actorId,
    action: "channel.provider_activation_revoked",
    targetType: "channel_provider_activation_authorization",
    targetId: authorizationId,
    metadata: {
      provider: "whatsapp_meta",
      scope: "meta_whatsapp_trial",
      sensitiveValueRecorded: false,
    },
  });
}

function mapStoredAuthorization(
  row: WhatsAppMetaActivationAuthorizationRow,
): WhatsAppMetaStoredTrialAuthorization {
  return {
    authorizationId: row.id,
    tenantId: row.tenant_id,
    endpointId: row.endpoint_id,
    provider: row.provider,
    scope: row.authorization_scope,
    maxMessages: 1,
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
  return new WhatsAppMetaActivationAuthorizationError(
    "channel_provider_activation_authorization_invalid",
    "L'autorisation d'essai WhatsApp Meta est invalide.",
  );
}

function authorizationNotFound() {
  return new WhatsAppMetaActivationAuthorizationError(
    "channel_provider_activation_authorization_not_found",
    "Autorisation d'essai WhatsApp Meta introuvable.",
  );
}
