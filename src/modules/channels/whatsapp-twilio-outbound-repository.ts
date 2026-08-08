import type { DbClient } from "@/lib/db";
import type { ChannelProviderFailureClassification } from "@/modules/channels/contracts";

export type WhatsAppOutboundContextRow = {
  endpoint_id: string;
  endpoint_status: "active" | "disabled";
  message_id: string;
  thread_id: string;
  message_direction: "inbound" | "outbound" | "internal";
  message_kind: "text" | "system" | "plan" | "approval" | "result";
  message_status: "received" | "pending" | "sent" | "delivered" | "failed";
  text_content: string | null;
  channel_identity_id: string;
  identity_adapter_key: string;
  identity_state: "active" | "unverified" | "blocked" | "revoked";
  identity_role: "customer" | "member" | "assistant" | "system";
  target_in_thread: boolean | number;
};

export type ChannelProviderDeliveryRow = {
  id: string;
  tenant_id: string;
  provider: "whatsapp_twilio";
  endpoint_id: string;
  message_id: string;
  channel_identity_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  status: "reserved" | "accepted" | "delivered" | "failed" | "denied";
  external_message_id: string | null;
  failure_classification: ChannelProviderFailureClassification | null;
  safe_error_code: string | null;
  retryable: boolean | number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export async function findWhatsAppOutboundContext(
  db: DbClient,
  input: {
    tenantId: string;
    endpointId: string;
    messageId: string;
    channelIdentityId: string;
  },
) {
  const result = await db.query<WhatsAppOutboundContextRow>(
    `select endpoint.id as endpoint_id,
            endpoint.status as endpoint_status,
            message.id as message_id,
            message.thread_id,
            message.direction as message_direction,
            message.kind as message_kind,
            message.status as message_status,
            message.text_content,
            identity.id as channel_identity_id,
            identity.adapter_key as identity_adapter_key,
            identity.state as identity_state,
            identity.role as identity_role,
            exists (
              select 1
              from conversation_thread_participants participant
              where participant.tenant_id = message.tenant_id
                and participant.thread_id = message.thread_id
                and participant.channel_identity_id = identity.id
                and participant.left_at is null
            ) as target_in_thread
     from channel_provider_endpoints endpoint
     join conversation_messages message
       on message.tenant_id = endpoint.tenant_id
      and message.id = $3
     join conversation_channel_identities identity
       on identity.tenant_id = endpoint.tenant_id
      and identity.id = $4
     where endpoint.tenant_id = $1
       and endpoint.id = $2
       and endpoint.provider = 'whatsapp_twilio'`,
    [input.tenantId, input.endpointId, input.messageId, input.channelIdentityId],
  );
  return result.rows[0] ?? null;
}

export async function reserveWhatsAppOutboundDelivery(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    endpointId: string;
    messageId: string;
    channelIdentityId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    actorId: string;
    occurredAt: string;
  },
) {
  const inserted = await db.query<ChannelProviderDeliveryRow>(
    `insert into channel_provider_deliveries (
       id, tenant_id, provider, endpoint_id, message_id, channel_identity_id,
       idempotency_key, request_fingerprint, status, external_message_id,
       failure_classification, safe_error_code, retryable, created_by,
       created_at, updated_at
     ) values (
       $1, $2, 'whatsapp_twilio', $3, $4, $5, $6, $7, 'reserved', null,
       null, null, null, $8, $9, $9
     )
     on conflict (tenant_id, provider, idempotency_key) do nothing
     returning *`,
    [
      input.id,
      input.tenantId,
      input.endpointId,
      input.messageId,
      input.channelIdentityId,
      input.idempotencyKey,
      input.requestFingerprint,
      input.actorId,
      input.occurredAt,
    ],
  );
  if (inserted.rows[0]) {
    return { row: inserted.rows[0], replayed: false };
  }

  const existing = await findWhatsAppOutboundDeliveryByIdempotency(db, {
    tenantId: input.tenantId,
    idempotencyKey: input.idempotencyKey,
  });
  return { row: existing, replayed: true };
}

export async function findWhatsAppOutboundDeliveryByIdempotency(
  db: DbClient,
  input: { tenantId: string; idempotencyKey: string },
) {
  const result = await db.query<ChannelProviderDeliveryRow>(
    `select *
     from channel_provider_deliveries
     where tenant_id = $1
       and provider = 'whatsapp_twilio'
       and idempotency_key = $2`,
    [input.tenantId, input.idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function finalizeWhatsAppOutboundDelivery(
  db: DbClient,
  input: {
    tenantId: string;
    deliveryId: string;
    status: Exclude<ChannelProviderDeliveryRow["status"], "reserved">;
    externalMessageId: string | null;
    failureClassification: ChannelProviderFailureClassification | null;
    safeErrorCode: string | null;
    retryable: boolean;
    updatedAt: string;
  },
) {
  const result = await db.query<ChannelProviderDeliveryRow>(
    `update channel_provider_deliveries
     set status = $1,
         external_message_id = $2,
         failure_classification = $3,
         safe_error_code = $4,
         retryable = $5,
         updated_at = $6
     where tenant_id = $7 and id = $8 and provider = 'whatsapp_twilio'
       and status = 'reserved'
     returning *`,
    [
      input.status,
      input.externalMessageId,
      input.failureClassification,
      input.safeErrorCode,
      input.retryable,
      input.updatedAt,
      input.tenantId,
      input.deliveryId,
    ],
  );
  return result.rows[0] ?? null;
}

export async function updateWhatsAppOutboundMessageState(
  db: DbClient,
  input: {
    tenantId: string;
    messageId: string;
    status: "sent" | "delivered" | "failed";
    safeErrorCode: string | null;
  },
) {
  const result = await db.query<{ id: string }>(
    `update conversation_messages
     set status = $1, safe_error_code = $2
     where tenant_id = $3 and id = $4
       and direction = 'outbound'
       and status = 'pending'
     returning id`,
    [
      input.status,
      input.safeErrorCode,
      input.tenantId,
      input.messageId,
    ],
  );
  return Boolean(result.rows[0]);
}
