import { createHmac } from "node:crypto";
import { z } from "zod";
import {
  withSystemDbTransaction,
  withTenantDbTransaction,
} from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { ChannelProviderEndpointError } from "@/modules/channels/provider-endpoints-errors";
import {
  findActiveChannelProviderEndpointByFingerprint,
  findChannelProviderEndpointById,
  inspectMetaWhatsAppTenantConfiguration,
  reserveChannelProviderEndpoint,
  updateChannelProviderEndpointStatus,
} from "@/modules/channels/provider-endpoints-repository";
import type { ExternalChannelProvider } from "@/modules/channels/contracts";
import { findMembershipRole } from "@/modules/tenants/repository";

const boundedIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const twilioAccountSidSchema = z.string().regex(/^AC[a-fA-F0-9]{32}$/);
const metaReferenceSchema = z.string().regex(/^\d{1,64}$/);
const microsoftUuidSchema = z.string().uuid().transform((value) => value.toLowerCase());
const slackAppIdSchema = z.string().regex(/^A[A-Z0-9]{8,63}$/);
const slackWorkspaceIdSchema = z.string().regex(/^T[A-Z0-9]{8,63}$/);
const whatsappAddressSchema = z
  .string()
  .trim()
  .regex(/^whatsapp:\+[1-9][0-9]{7,14}$/);
const fingerprintSecretSchema = z.string().min(32).max(512);

const registerWhatsAppEndpointSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    actorId: boundedIdentifierSchema,
    externalAccountId: twilioAccountSidSchema,
    destinationAddress: whatsappAddressSchema,
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const updateStatusSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    actorId: boundedIdentifierSchema,
    endpointId: boundedIdentifierSchema,
    status: z.enum(["active", "disabled"]),
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const resolveWhatsAppEndpointSchema = z
  .object({
    externalAccountId: twilioAccountSidSchema,
    destinationAddress: whatsappAddressSchema,
  })
  .strict();

const registerMetaWhatsAppEndpointSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    actorId: boundedIdentifierSchema,
    externalAccountId: metaReferenceSchema,
    phoneNumberId: metaReferenceSchema,
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const resolveMetaWhatsAppEndpointSchema = z
  .object({
    externalAccountId: metaReferenceSchema,
    phoneNumberId: metaReferenceSchema,
  })
  .strict();

const registerTeamsEndpointSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    actorId: boundedIdentifierSchema,
    externalAccountId: microsoftUuidSchema,
    microsoftTenantId: microsoftUuidSchema,
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const resolveTeamsEndpointSchema = z
  .object({
    externalAccountId: microsoftUuidSchema,
    microsoftTenantId: microsoftUuidSchema,
  })
  .strict();

const registerSlackEndpointSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    actorId: boundedIdentifierSchema,
    externalAccountId: slackAppIdSchema,
    workspaceId: slackWorkspaceIdSchema,
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const inspectMetaWhatsAppTenantReadinessSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    actorId: boundedIdentifierSchema,
  })
  .strict();

export type MetaWhatsAppTenantReadiness = {
  provider: "whatsapp_meta";
  state: "not_registered" | "disabled" | "credentials_missing" | "ready";
  checks: {
    endpoint: "missing" | "disabled" | "active";
    credentials: "not_checked" | "missing" | "active";
  };
};

export async function inspectMetaWhatsAppTenantReadiness(
  db: DbClient,
  actorId: string,
  tenantId: string,
): Promise<MetaWhatsAppTenantReadiness> {
  const parsed = inspectMetaWhatsAppTenantReadinessSchema.parse({
    tenantId,
    actorId,
  });
  return withTenantDbTransaction(
    db,
    parsed.tenantId,
    parsed.actorId,
    async (transaction) => {
      const role = await findMembershipRole(
        transaction,
        parsed.actorId,
        parsed.tenantId,
      );
      if (!role) {
        throw new ChannelProviderEndpointError(
          "channel_provider_endpoint_access_denied",
          "Accès refusé à l'état du canal.",
        );
      }

      const configuration = await inspectMetaWhatsAppTenantConfiguration(
        transaction,
        parsed.tenantId,
      );
      if (configuration.has_configured_endpoint) {
        return readiness("ready", "active", "active");
      }
      if (configuration.has_active_endpoint) {
        return readiness("credentials_missing", "active", "missing");
      }
      if (configuration.has_endpoint) {
        return readiness("disabled", "disabled", "not_checked");
      }
      return readiness("not_registered", "missing", "not_checked");
    },
  );
}

const resolveSlackEndpointSchema = z
  .object({
    externalAccountId: slackAppIdSchema,
    workspaceId: slackWorkspaceIdSchema,
  })
  .strict();

export async function registerAuthorizedWhatsAppEndpoint(
  db: DbClient,
  input: z.input<typeof registerWhatsAppEndpointSchema>,
  fingerprintSecret: string | undefined,
) {
  const parsed = registerWhatsAppEndpointSchema.parse(input);
  const secret = fingerprintSecretSchema.parse(fingerprintSecret);
  return registerAuthorizedEndpoint(db, {
    ...parsed,
    provider: "whatsapp_twilio",
    destinationValue: parsed.destinationAddress,
  }, secret);
}

export async function registerAuthorizedMetaWhatsAppEndpoint(
  db: DbClient,
  input: z.input<typeof registerMetaWhatsAppEndpointSchema>,
  fingerprintSecret: string | undefined,
) {
  const parsed = registerMetaWhatsAppEndpointSchema.parse(input);
  const secret = fingerprintSecretSchema.parse(fingerprintSecret);
  return registerAuthorizedEndpoint(
    db,
    {
      ...parsed,
      provider: "whatsapp_meta",
      destinationValue: parsed.phoneNumberId,
    },
    secret,
  );
}

export async function registerAuthorizedTeamsEndpoint(
  db: DbClient,
  input: z.input<typeof registerTeamsEndpointSchema>,
  fingerprintSecret: string | undefined,
) {
  const parsed = registerTeamsEndpointSchema.parse(input);
  const secret = fingerprintSecretSchema.parse(fingerprintSecret);
  return registerAuthorizedEndpoint(db, {
    ...parsed,
    provider: "teams_microsoft",
    destinationValue: parsed.microsoftTenantId,
  }, secret);
}

export async function registerAuthorizedSlackEndpoint(
  db: DbClient,
  input: z.input<typeof registerSlackEndpointSchema>,
  fingerprintSecret: string | undefined,
) {
  const parsed = registerSlackEndpointSchema.parse(input);
  const secret = fingerprintSecretSchema.parse(fingerprintSecret);
  return registerAuthorizedEndpoint(
    db,
    {
      ...parsed,
      provider: "slack",
      destinationValue: parsed.workspaceId,
    },
    secret,
  );
}

async function registerAuthorizedEndpoint(
  db: DbClient,
  parsed: {
    tenantId: string;
    actorId: string;
    provider: ExternalChannelProvider;
    externalAccountId: string;
    destinationValue: string;
    occurredAt?: string;
  },
  secret: string,
) {
  return withTenantDbTransaction(
    db,
    parsed.tenantId,
    parsed.actorId,
    async (transaction) => {
      await requireEndpointAdministrator(
        transaction,
        parsed.actorId,
        parsed.tenantId,
      );
      const reservation = await reserveChannelProviderEndpoint(transaction, {
        id: id("channel_endpoint"),
        tenantId: parsed.tenantId,
        provider: parsed.provider,
        externalAccountId: parsed.externalAccountId,
        destinationFingerprint: endpointFingerprint(
          parsed.provider,
          parsed.externalAccountId,
          parsed.destinationValue,
          secret,
        ),
        actorId: parsed.actorId,
        occurredAt: parsed.occurredAt ?? nowIso(),
      });
      if (!reservation.row) {
        throw new ChannelProviderEndpointError(
          "channel_provider_endpoint_conflict",
          "Cet endpoint fournisseur est déjà attribué.",
        );
      }

      if (!reservation.replayed) {
        await recordAuditLog(transaction, {
          tenantId: parsed.tenantId,
          actorId: parsed.actorId,
          action: "channel.provider_endpoint_registered",
          targetType: "channel_provider_endpoint",
          targetId: reservation.row.id,
          metadata: {
            provider: parsed.provider,
            status: reservation.row.status,
          },
        });
      }

      return {
        endpointId: reservation.row.id,
        status: reservation.row.status,
        replayed: reservation.replayed,
      };
    },
  );
}

export async function setAuthorizedWhatsAppEndpointStatus(
  db: DbClient,
  input: z.input<typeof updateStatusSchema>,
) {
  const parsed = updateStatusSchema.parse(input);
  return setAuthorizedEndpointStatus(db, parsed, "whatsapp_twilio");
}

export async function setAuthorizedMetaWhatsAppEndpointStatus(
  db: DbClient,
  input: z.input<typeof updateStatusSchema>,
) {
  const parsed = updateStatusSchema.parse(input);
  return setAuthorizedEndpointStatus(db, parsed, "whatsapp_meta");
}

export async function setAuthorizedTeamsEndpointStatus(
  db: DbClient,
  input: z.input<typeof updateStatusSchema>,
) {
  const parsed = updateStatusSchema.parse(input);
  return setAuthorizedEndpointStatus(db, parsed, "teams_microsoft");
}

export async function setAuthorizedSlackEndpointStatus(
  db: DbClient,
  input: z.input<typeof updateStatusSchema>,
) {
  const parsed = updateStatusSchema.parse(input);
  return setAuthorizedEndpointStatus(db, parsed, "slack");
}

async function setAuthorizedEndpointStatus(
  db: DbClient,
  parsed: z.output<typeof updateStatusSchema>,
  provider: ExternalChannelProvider,
) {
  return withTenantDbTransaction(
    db,
    parsed.tenantId,
    parsed.actorId,
    async (transaction) => {
      await requireEndpointAdministrator(
        transaction,
        parsed.actorId,
        parsed.tenantId,
      );
      const existing = await findChannelProviderEndpointById(
        transaction,
        parsed.tenantId,
        parsed.endpointId,
        provider,
      );
      if (!existing) {
        throw new ChannelProviderEndpointError(
          "channel_provider_endpoint_not_found",
          "Endpoint fournisseur introuvable.",
        );
      }
      if (existing.status === parsed.status) {
        return {
          endpointId: existing.id,
          status: existing.status,
          replayed: true,
        };
      }

      const updated = await updateChannelProviderEndpointStatus(transaction, {
        tenantId: parsed.tenantId,
        endpointId: parsed.endpointId,
        provider,
        status: parsed.status,
        updatedAt: parsed.occurredAt ?? nowIso(),
      });
      if (!updated) {
        throw new ChannelProviderEndpointError(
          "channel_provider_endpoint_not_found",
          "Endpoint fournisseur introuvable.",
        );
      }
      await recordAuditLog(transaction, {
        tenantId: parsed.tenantId,
        actorId: parsed.actorId,
        action: "channel.provider_endpoint_status_changed",
        targetType: "channel_provider_endpoint",
        targetId: updated.id,
        metadata: {
          provider,
          previousStatus: existing.status,
          status: updated.status,
        },
      });
      return { endpointId: updated.id, status: updated.status, replayed: false };
    },
  );
}

export async function resolveActiveWhatsAppEndpoint(
  db: DbClient,
  input: z.input<typeof resolveWhatsAppEndpointSchema>,
  fingerprintSecret: string | undefined,
) {
  const parsed = resolveWhatsAppEndpointSchema.parse(input);
  const secret = fingerprintSecretSchema.parse(fingerprintSecret);
  return resolveActiveEndpoint(db, {
    provider: "whatsapp_twilio",
    externalAccountId: parsed.externalAccountId,
    destinationValue: parsed.destinationAddress,
  }, secret);
}

export async function resolveActiveMetaWhatsAppEndpoint(
  db: DbClient,
  input: z.input<typeof resolveMetaWhatsAppEndpointSchema>,
  fingerprintSecret: string | undefined,
) {
  const parsed = resolveMetaWhatsAppEndpointSchema.parse(input);
  const secret = fingerprintSecretSchema.parse(fingerprintSecret);
  return resolveActiveEndpoint(
    db,
    {
      provider: "whatsapp_meta",
      externalAccountId: parsed.externalAccountId,
      destinationValue: parsed.phoneNumberId,
    },
    secret,
  );
}

export async function resolveActiveTeamsEndpoint(
  db: DbClient,
  input: z.input<typeof resolveTeamsEndpointSchema>,
  fingerprintSecret: string | undefined,
) {
  const parsed = resolveTeamsEndpointSchema.parse(input);
  const secret = fingerprintSecretSchema.parse(fingerprintSecret);
  return resolveActiveEndpoint(db, {
    provider: "teams_microsoft",
    externalAccountId: parsed.externalAccountId,
    destinationValue: parsed.microsoftTenantId,
  }, secret);
}

export async function resolveActiveSlackEndpoint(
  db: DbClient,
  input: z.input<typeof resolveSlackEndpointSchema>,
  fingerprintSecret: string | undefined,
) {
  const parsed = resolveSlackEndpointSchema.parse(input);
  const secret = fingerprintSecretSchema.parse(fingerprintSecret);
  return resolveActiveEndpoint(
    db,
    {
      provider: "slack",
      externalAccountId: parsed.externalAccountId,
      destinationValue: parsed.workspaceId,
    },
    secret,
  );
}

async function resolveActiveEndpoint(
  db: DbClient,
  parsed: {
    provider: ExternalChannelProvider;
    externalAccountId: string;
    destinationValue: string;
  },
  secret: string,
) {
  return withSystemDbTransaction(db, async (transaction) => {
    const endpoint = await findActiveChannelProviderEndpointByFingerprint(transaction, {
      provider: parsed.provider,
      externalAccountId: parsed.externalAccountId,
      destinationFingerprint: endpointFingerprint(
        parsed.provider,
        parsed.externalAccountId,
        parsed.destinationValue,
        secret,
      ),
    });
    if (!endpoint) return null;
    return { endpointId: endpoint.id, tenantId: endpoint.tenant_id };
  });
}

async function requireEndpointAdministrator(
  db: DbClient,
  actorId: string,
  tenantId: string,
) {
  const role = await findMembershipRole(db, actorId, tenantId);
  if (role !== "owner" && role !== "administrator") {
    throw new ChannelProviderEndpointError(
      "channel_provider_endpoint_access_denied",
      "Accès refusé à la configuration du canal.",
    );
  }
}

function readiness(
  state: MetaWhatsAppTenantReadiness["state"],
  endpoint: MetaWhatsAppTenantReadiness["checks"]["endpoint"],
  credentials: MetaWhatsAppTenantReadiness["checks"]["credentials"],
): MetaWhatsAppTenantReadiness {
  return {
    provider: "whatsapp_meta",
    state,
    checks: { endpoint, credentials },
  };
}

function endpointFingerprint(
  provider: ExternalChannelProvider,
  externalAccountId: string,
  destinationValue: string,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(`v1:${provider}:${externalAccountId}:${destinationValue}`)
    .digest("hex");
}
