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
  findActiveWhatsAppEndpointByFingerprint,
  findChannelProviderEndpointById,
  reserveChannelProviderEndpoint,
  updateChannelProviderEndpointStatus,
} from "@/modules/channels/provider-endpoints-repository";
import { findMembershipRole } from "@/modules/tenants/repository";

const boundedIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const twilioAccountSidSchema = z.string().regex(/^AC[a-fA-F0-9]{32}$/);
const whatsappAddressSchema = z
  .string()
  .trim()
  .regex(/^whatsapp:\+[1-9][0-9]{7,14}$/);
const fingerprintSecretSchema = z.string().min(32).max(512);

const registerEndpointSchema = z
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

const resolveEndpointSchema = z
  .object({
    externalAccountId: twilioAccountSidSchema,
    destinationAddress: whatsappAddressSchema,
  })
  .strict();

export async function registerAuthorizedWhatsAppEndpoint(
  db: DbClient,
  input: z.input<typeof registerEndpointSchema>,
  fingerprintSecret: string | undefined,
) {
  const parsed = registerEndpointSchema.parse(input);
  const secret = fingerprintSecretSchema.parse(fingerprintSecret);
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
        externalAccountId: parsed.externalAccountId,
        destinationFingerprint: endpointFingerprint(
          parsed.externalAccountId,
          parsed.destinationAddress,
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
            provider: "whatsapp_twilio",
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
          provider: "whatsapp_twilio",
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
  input: z.input<typeof resolveEndpointSchema>,
  fingerprintSecret: string | undefined,
) {
  const parsed = resolveEndpointSchema.parse(input);
  const secret = fingerprintSecretSchema.parse(fingerprintSecret);
  return withSystemDbTransaction(db, async (transaction) => {
    const endpoint = await findActiveWhatsAppEndpointByFingerprint(transaction, {
      externalAccountId: parsed.externalAccountId,
      destinationFingerprint: endpointFingerprint(
        parsed.externalAccountId,
        parsed.destinationAddress,
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

function endpointFingerprint(
  externalAccountId: string,
  destinationAddress: string,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(`v1:whatsapp_twilio:${externalAccountId}:${destinationAddress}`)
    .digest("hex");
}
