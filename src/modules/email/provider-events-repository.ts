import type { DbClient } from "@/lib/db";

export type EmailProviderDeliveryRow = {
  id: string;
  tenant_id: string;
  source_type: "invitation";
  source_id: string;
  provider: "resend";
  provider_message_id: string;
  recipient_hash: string;
  status: "sent" | "delayed" | "delivered" | "failed";
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EmailProviderEventRow = {
  id: string;
  tenant_id: string;
  delivery_id: string;
  provider: "resend";
  external_event_id: string;
  provider_message_id: string;
  event_type: string;
  delivery_status: "sent" | "delayed" | "delivered" | "failed";
  occurred_at: string;
  received_at: string;
};

export async function reserveEmailProviderDelivery(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    sourceId: string;
    providerMessageId: string;
    recipientHash: string;
    occurredAt: string;
  },
) {
  const inserted = await db.query<EmailProviderDeliveryRow>(
    `insert into email_provider_deliveries (
       id, tenant_id, source_type, source_id, provider, provider_message_id,
       recipient_hash, status, last_event_at, created_at, updated_at
     ) values ($1, $2, 'invitation', $3, 'resend', $4, $5, 'sent',
       null, $6, $6)
     on conflict (provider, provider_message_id) do nothing
     returning *`,
    [
      input.id,
      input.tenantId,
      input.sourceId,
      input.providerMessageId,
      input.recipientHash,
      input.occurredAt,
    ],
  );

  if (inserted.rows[0]) {
    return { row: inserted.rows[0], replayed: false };
  }

  const existing = await db.query<EmailProviderDeliveryRow>(
    `select *
     from email_provider_deliveries
     where tenant_id = $1 and provider = 'resend' and provider_message_id = $2`,
    [input.tenantId, input.providerMessageId],
  );
  return { row: existing.rows[0] ?? null, replayed: true };
}

export async function findEmailProviderDeliveryForUpdate(
  db: DbClient,
  input: { tenantId: string; providerMessageId: string },
) {
  const result = await db.query<EmailProviderDeliveryRow>(
    `select *
     from email_provider_deliveries
     where tenant_id = $1 and provider = 'resend' and provider_message_id = $2
     for update`,
    [input.tenantId, input.providerMessageId],
  );
  return result.rows[0] ?? null;
}

export async function reserveEmailProviderEvent(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    deliveryId: string;
    externalEventId: string;
    providerMessageId: string;
    eventType: string;
    deliveryStatus: EmailProviderEventRow["delivery_status"];
    occurredAt: string;
    receivedAt: string;
  },
) {
  const inserted = await db.query<EmailProviderEventRow>(
    `insert into email_provider_events (
       id, tenant_id, delivery_id, provider, external_event_id,
       provider_message_id, event_type, delivery_status, occurred_at, received_at
     ) values ($1, $2, $3, 'resend', $4, $5, $6, $7, $8, $9)
     on conflict (provider, external_event_id) do nothing
     returning *`,
    [
      input.id,
      input.tenantId,
      input.deliveryId,
      input.externalEventId,
      input.providerMessageId,
      input.eventType,
      input.deliveryStatus,
      input.occurredAt,
      input.receivedAt,
    ],
  );

  if (inserted.rows[0]) {
    return { row: inserted.rows[0], replayed: false };
  }

  const existing = await db.query<EmailProviderEventRow>(
    `select *
     from email_provider_events
     where tenant_id = $1 and provider = 'resend' and external_event_id = $2`,
    [input.tenantId, input.externalEventId],
  );
  return { row: existing.rows[0] ?? null, replayed: true };
}

export async function updateEmailProviderDeliveryState(
  db: DbClient,
  input: {
    tenantId: string;
    deliveryId: string;
    providerMessageId: string;
    status: EmailProviderDeliveryRow["status"];
    occurredAt: string;
    updatedAt: string;
  },
) {
  await db.query(
    `update email_provider_deliveries
     set status = $1, last_event_at = $2, updated_at = $3
     where tenant_id = $4 and id = $5 and provider = 'resend'
       and provider_message_id = $6`,
    [
      input.status,
      input.occurredAt,
      input.updatedAt,
      input.tenantId,
      input.deliveryId,
      input.providerMessageId,
    ],
  );
}
