import type { DbClient } from "@/lib/db";
import { id, nowIso, toJson } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { NotificationError } from "@/modules/notifications/errors";
import {
  findNotificationById,
  insertNotification,
  tenantRecipientExists,
  updateNotificationStatus,
} from "@/modules/notifications/repository";
import {
  notificationChannelSchema,
  notificationDispatchPayloadSchema,
  type NotificationChannel,
} from "@/modules/notifications/schemas";

export const notificationDispatchRequestedEventType =
  "notification.dispatch_requested";

export async function queueWorkflowNotification(
  db: DbClient,
  input: {
    tenantId: string;
    actorId: string;
    channel: string;
    recipientUserId: string;
    message: string;
    correlationId: string;
    causationId?: string;
    createdAt?: string;
  },
) {
  const channel = notificationChannelSchema.parse(input.channel);
  const notificationId = id("notification");
  const createdAt = input.createdAt ?? nowIso();

  await insertNotification(db, {
    id: notificationId,
    tenantId: input.tenantId,
    channel,
    recipientUserId: input.recipientUserId,
    message: input.message,
    status: "queued",
    createdAt,
  });
  await enqueueNotificationDispatchEvent(db, {
    tenantId: input.tenantId,
    actorId: input.actorId,
    notificationId,
    channel,
    correlationId: input.correlationId,
    causationId: input.causationId,
    nextRunAt: createdAt,
  });

  return notificationId;
}

export async function dispatchQueuedNotification(
  db: DbClient,
  input: {
    tenantId: string;
    actorId: string;
    payload: Record<string, unknown>;
    correlationId: string;
  },
) {
  const payload = notificationDispatchPayloadSchema.parse(input.payload);
  const notification = await findNotificationById(
    db,
    input.tenantId,
    payload.notificationId,
  );

  if (!notification) {
    throw new NotificationError(
      "notification_not_found",
      "Notification introuvable pour ce tenant.",
    );
  }

  if (notification.status === "sent") {
    return notification;
  }

  if (notification.status !== "queued") {
    throw new NotificationError(
      "notification_invalid",
      "Notification non prete pour envoi.",
    );
  }

  const recipientExists = await tenantRecipientExists(
    db,
    input.tenantId,
    notification.recipient_user_id,
  );

  if (!recipientExists) {
    throw new NotificationError(
      "notification_recipient_not_found",
      "Destinataire notification introuvable dans ce tenant.",
    );
  }

  const sent = await updateNotificationStatus(db, {
    tenantId: input.tenantId,
    notificationId: notification.id,
    status: "sent",
  });

  await recordAuditLog(db, {
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: "notification.dispatched",
    targetType: "notification",
    targetId: notification.id,
    metadata: {
      channel: notification.channel,
      recipientUserId: notification.recipient_user_id,
      correlationId: input.correlationId,
    },
  });

  return sent ?? notification;
}

async function enqueueNotificationDispatchEvent(
  db: DbClient,
  input: {
    tenantId: string;
    actorId: string;
    notificationId: string;
    channel: NotificationChannel;
    correlationId: string;
    causationId?: string;
    nextRunAt: string;
  },
) {
  const now = nowIso();
  const idempotencyKey = `notification.dispatch:${input.notificationId}`;
  const existing = await db.query<{ id: string }>(
    "select id from domain_events where tenant_id = $1 and idempotency_key = $2 limit 1",
    [input.tenantId, idempotencyKey],
  );

  if (existing.rows[0]) {
    return false;
  }

  await db.query(
    `insert into domain_events (
       id,
       tenant_id,
       actor_id,
       event_type,
       payload,
       status,
       attempts,
       idempotency_key,
       correlation_id,
       causation_id,
       next_run_at,
       last_error,
       created_at,
       updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (tenant_id, idempotency_key) do nothing`,
    [
      id("event"),
      input.tenantId,
      input.actorId,
      notificationDispatchRequestedEventType,
      toJson({
        notificationId: input.notificationId,
        channel: input.channel,
      }),
      "pending",
      0,
      idempotencyKey,
      input.correlationId,
      input.causationId ?? null,
      input.nextRunAt,
      null,
      now,
      now,
    ],
  );

  return true;
}
