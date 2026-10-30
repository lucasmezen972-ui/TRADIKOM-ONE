import {
  withSystemDbTransaction,
  withTenantDbTransaction,
} from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { hashToken, id, nowIso } from "@/lib/security";
import { z } from "zod";
import { recordAuditLog } from "@/modules/audit";
import { emailAddressSchema } from "@/modules/email/schemas";
import { EmailProviderEventError } from "@/modules/email/provider-events-errors";
import {
  findEmailProviderDeliveryForUpdate,
  reserveEmailProviderDelivery,
  reserveEmailProviderEvent,
  updateEmailProviderDeliveryState,
  type EmailProviderDeliveryRow,
  type EmailProviderEventRow,
} from "@/modules/email/provider-events-repository";
import {
  verifyResendWebhook,
  type ResendWebhookVerificationResult,
  type SafeResendWebhookEvent,
} from "@/modules/email/resend-webhook";
import {
  findMembershipRole,
  findPendingInvitationForTenant,
} from "@/modules/tenants/repository";

const boundedIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const providerReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const resendDeliveryRecordSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    actorId: boundedIdentifierSchema,
    invitationId: boundedIdentifierSchema,
    recipient: emailAddressSchema,
    providerMessageId: providerReferenceSchema,
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export async function recordAuthorizedResendDelivery(
  db: DbClient,
  input: {
    tenantId: string;
    actorId: string;
    invitationId: string;
    recipient: string;
    providerMessageId: string;
    occurredAt?: string;
  },
) {
  const parsed = resendDeliveryRecordSchema.parse(input);
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
      if (role !== "owner" && role !== "administrator") {
        throw new EmailProviderEventError(
          "email_provider_access_denied",
          "Accès refusé à la livraison email.",
        );
      }

      const invitation = await findPendingInvitationForTenant(
        transaction,
        parsed.tenantId,
        parsed.invitationId,
      );
      if (!invitation || invitation.email.toLowerCase() !== parsed.recipient) {
        throw new EmailProviderEventError(
          "email_provider_delivery_conflict",
          "La livraison email ne correspond pas à l'invitation.",
        );
      }

      const occurredAt = parsed.occurredAt ?? nowIso();
      const reservation = await reserveEmailProviderDelivery(transaction, {
        id: id("email_delivery"),
        tenantId: parsed.tenantId,
        sourceId: parsed.invitationId,
        providerMessageId: parsed.providerMessageId,
        recipientHash: hashToken(parsed.recipient),
        occurredAt,
      });

      if (!reservation.row) {
        throw new EmailProviderEventError(
          "email_provider_delivery_conflict",
          "La référence de livraison email est déjà attribuée.",
        );
      }
      if (
        reservation.row.source_id !== parsed.invitationId ||
        reservation.row.recipient_hash !== hashToken(parsed.recipient)
      ) {
        throw new EmailProviderEventError(
          "email_provider_delivery_conflict",
          "La référence de livraison email ne correspond pas.",
        );
      }

      if (!reservation.replayed) {
        await recordAuditLog(transaction, {
          tenantId: parsed.tenantId,
          actorId: parsed.actorId,
          action: "email.provider_delivery_recorded",
          targetType: "email_provider_delivery",
          targetId: reservation.row.id,
          metadata: {
            provider: "resend",
            sourceType: "invitation",
            sourceId: parsed.invitationId,
            status: "sent",
          },
        });
      }

      return {
        deliveryId: reservation.row.id,
        status: reservation.row.status,
        replayed: reservation.replayed,
      };
    },
  );
}

export async function receivePreparedResendWebhook(
  db: DbClient,
  input: unknown,
  signingSecret: string | undefined,
) {
  const verification = verifyResendWebhook(input, signingSecret);
  if (!verification.ok) return rejectedVerification(verification);

  return withSystemDbTransaction(db, (transaction) =>
    persistVerifiedEvent(transaction, verification.event),
  );
}

async function persistVerifiedEvent(
  db: DbClient,
  event: SafeResendWebhookEvent,
) {
  const delivery = await findEmailProviderDeliveryForUpdate(db, {
    tenantId: event.tenantId,
    providerMessageId: event.providerEmailId,
  });
  if (!delivery) {
    return {
      accepted: false as const,
      code: "email_provider_delivery_not_found" as const,
    };
  }

  const receivedAt = nowIso();
  const reservation = await reserveEmailProviderEvent(db, {
    id: id("email_event"),
    tenantId: event.tenantId,
    deliveryId: delivery.id,
    externalEventId: event.externalEventId,
    providerMessageId: event.providerEmailId,
    eventType: event.eventType,
    deliveryStatus: event.deliveryStatus,
    occurredAt: event.occurredAt,
    receivedAt,
  });
  if (!reservation.row) {
    return {
      accepted: false as const,
      code: "email_provider_event_conflict" as const,
    };
  }
  if (
    reservation.replayed &&
    !sameEvent(reservation.row, delivery, event)
  ) {
    return {
      accepted: false as const,
      code: "email_provider_event_conflict" as const,
    };
  }
  if (reservation.replayed) {
    return {
      accepted: true as const,
      replayed: true,
      stateUpdated: false,
      deliveryId: delivery.id,
      status: delivery.status,
    };
  }

  const stateUpdated = shouldUpdateState(delivery, event);
  if (stateUpdated) {
    await updateEmailProviderDeliveryState(db, {
      tenantId: event.tenantId,
      deliveryId: delivery.id,
      providerMessageId: event.providerEmailId,
      status: event.deliveryStatus,
      occurredAt: event.occurredAt,
      updatedAt: receivedAt,
    });
  }

  await recordAuditLog(db, {
    tenantId: event.tenantId,
    actorId: "system",
    action: "email.provider_event_received",
    targetType: "email_provider_delivery",
    targetId: delivery.id,
    metadata: {
      provider: "resend",
      externalEventId: event.externalEventId,
      eventType: event.eventType,
      status: event.deliveryStatus,
      stateUpdated,
    },
  });

  return {
    accepted: true as const,
    replayed: false,
    stateUpdated,
    deliveryId: delivery.id,
    status: stateUpdated ? event.deliveryStatus : delivery.status,
  };
}

function sameEvent(
  existing: EmailProviderEventRow,
  delivery: EmailProviderDeliveryRow,
  event: SafeResendWebhookEvent,
) {
  return (
    existing.tenant_id === event.tenantId &&
    existing.delivery_id === delivery.id &&
    existing.provider_message_id === event.providerEmailId &&
    existing.event_type === event.eventType &&
    existing.delivery_status === event.deliveryStatus &&
    existing.occurred_at === event.occurredAt
  );
}

function shouldUpdateState(
  delivery: EmailProviderDeliveryRow,
  event: SafeResendWebhookEvent,
) {
  if (!delivery.last_event_at) return true;

  const currentTime = Date.parse(delivery.last_event_at);
  const eventTime = Date.parse(event.occurredAt);
  if (eventTime > currentTime) return true;
  if (eventTime < currentTime) return false;
  return statusRank(event.deliveryStatus) > statusRank(delivery.status);
}

function statusRank(status: EmailProviderDeliveryRow["status"]) {
  return { sent: 1, delayed: 2, delivered: 3, failed: 4 }[status];
}

function rejectedVerification(
  verification: Exclude<ResendWebhookVerificationResult, { ok: true }>,
) {
  return { accepted: false as const, code: verification.code };
}
