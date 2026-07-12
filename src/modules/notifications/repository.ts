import type { DbClient } from "@/lib/db";

export type NotificationRow = {
  id: string;
  tenant_id: string;
  channel: string;
  recipient_user_id: string;
  message: string;
  status: string;
  created_at: string;
};

export async function insertNotification(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    channel: string;
    recipientUserId: string;
    message: string;
    status: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into notifications (
       id,
       tenant_id,
       channel,
       recipient_user_id,
       message,
       status,
       created_at
     ) values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.id,
      input.tenantId,
      input.channel,
      input.recipientUserId,
      input.message,
      input.status,
      input.createdAt,
    ],
  );
}

export async function findNotificationById(
  db: DbClient,
  tenantId: string,
  notificationId: string,
) {
  const result = await db.query<NotificationRow>(
    "select * from notifications where tenant_id = $1 and id = $2 limit 1",
    [tenantId, notificationId],
  );

  return result.rows[0] ?? null;
}

export async function updateNotificationStatus(
  db: DbClient,
  input: {
    tenantId: string;
    notificationId: string;
    status: string;
  },
) {
  const result = await db.query<NotificationRow>(
    `update notifications
     set status = $1
     where tenant_id = $2 and id = $3
     returning *`,
    [input.status, input.tenantId, input.notificationId],
  );

  return result.rows[0] ?? null;
}

export async function tenantRecipientExists(
  db: DbClient,
  tenantId: string,
  userId: string,
) {
  const result = await db.query<{ id: string }>(
    "select user_id as id from memberships where tenant_id = $1 and user_id = $2 limit 1",
    [tenantId, userId],
  );

  return Boolean(result.rows[0]);
}
