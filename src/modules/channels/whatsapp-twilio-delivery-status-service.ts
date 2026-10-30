import { withSystemDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { hashToken, id, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import {
  verifyWhatsAppTwilioDeliveryStatus,
} from "@/modules/channels/whatsapp-twilio-delivery-status";
import {
  findWhatsAppOutboundDeliveryForStatusUpdate,
  reserveWhatsAppOutboundDeliveryEvent,
  updateWhatsAppOutboundDeliveryFromStatus,
  updateWhatsAppOutboundMessageFromStatus,
  type ChannelProviderDeliveryEventRow,
  type ChannelProviderDeliveryRow,
  type WhatsAppOutboundProvider,
} from "@/modules/channels/whatsapp-twilio-outbound-repository";

export type VerifiedWhatsAppDeliveryStatus = {
  providerMessageId: string;
  sourceStatus: string;
  status: "accepted" | "delivered" | "failed";
  safeErrorCode: string | null;
};

export async function receivePreparedWhatsAppDeliveryStatus(
  db: DbClient,
  input: unknown,
  options: { authToken: string | undefined },
) {
  const verification = verifyWhatsAppTwilioDeliveryStatus(
    input,
    options.authToken,
  );
  if (!verification.ok) {
    return { accepted: false as const, code: verification.code };
  }

  return withSystemDbTransaction(db, (transaction) =>
    persistVerifiedWhatsAppDeliveryStatus(transaction, verification.event, {
      provider: "whatsapp_twilio",
    }),
  );
}

export async function persistVerifiedWhatsAppDeliveryStatus(
  db: DbClient,
  event: VerifiedWhatsAppDeliveryStatus,
  options: {
    provider: WhatsAppOutboundProvider;
    endpointId?: string;
  },
) {
  const delivery = await findWhatsAppOutboundDeliveryForStatusUpdate(db, {
    externalMessageId: event.providerMessageId,
    provider: options.provider,
    endpointId: options.endpointId,
  });
  if (!delivery) {
    return {
      accepted: false as const,
      code: "channel_provider_delivery_not_found" as const,
    };
  }

  const receivedAt = nowIso();
  const eventKey = hashToken(
    JSON.stringify([
      delivery.tenant_id,
      delivery.provider,
      event.providerMessageId,
      event.sourceStatus,
    ]),
  );
  const reservation = await reserveWhatsAppOutboundDeliveryEvent(db, {
    id: id("channel_delivery_event"),
    tenantId: delivery.tenant_id,
    deliveryId: delivery.id,
    eventKey,
    status: event.status,
    safeErrorCode: event.safeErrorCode,
    receivedAt,
    provider: options.provider,
  });
  if (!reservation.row) {
    return {
      accepted: false as const,
      code: "channel_provider_delivery_event_conflict" as const,
    };
  }
  if (!sameEvent(reservation.row, delivery, event, eventKey)) {
    return {
      accepted: false as const,
      code: "channel_provider_delivery_event_conflict" as const,
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

  const stateUpdated = shouldUpdateState(delivery.status, event.status);
  let finalStatus = delivery.status;
  if (stateUpdated) {
    const updated = await updateWhatsAppOutboundDeliveryFromStatus(db, {
      tenantId: delivery.tenant_id,
      deliveryId: delivery.id,
      externalMessageId: event.providerMessageId,
      status: event.status,
      safeErrorCode: event.safeErrorCode,
      updatedAt: receivedAt,
      provider: options.provider,
    });
    if (!updated) {
      throw new Error("La livraison WhatsApp ne peut pas être réconciliée.");
    }
    const messageUpdated = await updateWhatsAppOutboundMessageFromStatus(db, {
      tenantId: delivery.tenant_id,
      messageId: delivery.message_id,
      status: messageStatus(event.status),
      safeErrorCode: event.safeErrorCode,
    });
    if (!messageUpdated) {
      throw new Error("Le message WhatsApp ne peut pas être réconcilié.");
    }
    finalStatus = updated.status;
  }

  await recordAuditLog(db, {
    tenantId: delivery.tenant_id,
    actorId: "system",
    action: "channel.whatsapp_delivery_status_received",
    targetType: "channel_provider_delivery",
    targetId: delivery.id,
    metadata: {
      provider: delivery.provider,
      status: event.status,
      stateUpdated,
      contentStoredInAudit: false,
      providerReferenceStoredInAudit: false,
      providerErrorCodeStoredInAudit: false,
      payloadStoredInAudit: false,
    },
  });

  return {
    accepted: true as const,
    replayed: false,
    stateUpdated,
    deliveryId: delivery.id,
    status: finalStatus,
  };
}

function sameEvent(
  existing: ChannelProviderDeliveryEventRow,
  delivery: ChannelProviderDeliveryRow,
  event: VerifiedWhatsAppDeliveryStatus,
  eventKey: string,
) {
  return (
    existing.tenant_id === delivery.tenant_id &&
    existing.delivery_id === delivery.id &&
    existing.provider === delivery.provider &&
    existing.event_key === eventKey &&
    existing.status === event.status &&
    existing.safe_error_code === event.safeErrorCode
  );
}

function shouldUpdateState(
  current: ChannelProviderDeliveryRow["status"],
  candidate: VerifiedWhatsAppDeliveryStatus["status"],
) {
  const ranks: Record<ChannelProviderDeliveryRow["status"], number> = {
    reserved: 0,
    accepted: 1,
    failed: 2,
    delivered: 3,
    denied: 4,
  };
  return ranks[candidate] > ranks[current] && current !== "denied";
}

function messageStatus(
  status: VerifiedWhatsAppDeliveryStatus["status"],
) {
  return status === "accepted" ? "sent" : status;
}
