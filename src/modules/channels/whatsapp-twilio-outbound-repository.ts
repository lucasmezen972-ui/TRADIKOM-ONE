import type { DbClient } from "@/lib/db";
import type {
  ChannelProviderFailureClassification,
  ExternalChannelProvider,
} from "@/modules/channels/contracts";

export type WhatsAppOutboundProvider = Extract<
  ExternalChannelProvider,
  "whatsapp_twilio" | "whatsapp_meta"
>;

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
  provider: WhatsAppOutboundProvider;
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
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_attempted_at: string | null;
  lease_id: string | null;
  lease_expires_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ChannelProviderDeliveryEventRow = {
  id: string;
  tenant_id: string;
  delivery_id: string;
  provider: WhatsAppOutboundProvider;
  event_key: string;
  status: "accepted" | "delivered" | "failed";
  safe_error_code: string | null;
  received_at: string;
};

export async function findWhatsAppOutboundContext(
  db: DbClient,
  input: {
    tenantId: string;
    endpointId: string;
    messageId: string;
    channelIdentityId: string;
    provider?: WhatsAppOutboundProvider;
    requireIdentityBinding?: boolean;
  },
) {
  const provider = input.provider ?? "whatsapp_twilio";
  const requireIdentityBinding = input.requireIdentityBinding ?? false;
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
       and endpoint.provider = $5
       and (
         $6 = false
         or exists (
           select 1
           from channel_provider_identity_bindings binding
           where binding.tenant_id = endpoint.tenant_id
             and binding.provider = endpoint.provider
             and binding.endpoint_id = endpoint.id
             and binding.channel_identity_id = identity.id
         )
       )`,
    [
      input.tenantId,
      input.endpointId,
      input.messageId,
      input.channelIdentityId,
      provider,
      requireIdentityBinding,
    ],
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
    maxAttempts: number;
    provider?: WhatsAppOutboundProvider;
  },
) {
  const provider = input.provider ?? "whatsapp_twilio";
  const inserted = await db.query<ChannelProviderDeliveryRow>(
    `insert into channel_provider_deliveries (
       id, tenant_id, provider, endpoint_id, message_id, channel_identity_id,
       idempotency_key, request_fingerprint, status, external_message_id,
       failure_classification, safe_error_code, retryable, attempts,
       max_attempts, next_attempt_at, last_attempted_at, lease_id,
       lease_expires_at, created_by, created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, 'reserved', null,
       null, null, null, 0, $9, $10, null, null, null, $11, $10, $10
     )
     on conflict (tenant_id, provider, idempotency_key) do nothing
     returning *`,
    [
      input.id,
      input.tenantId,
      provider,
      input.endpointId,
      input.messageId,
      input.channelIdentityId,
      input.idempotencyKey,
      input.requestFingerprint,
      input.maxAttempts,
      input.occurredAt,
      input.actorId,
    ],
  );
  if (inserted.rows[0]) {
    return { row: inserted.rows[0], replayed: false };
  }

  const existing = await findWhatsAppOutboundDeliveryByIdempotency(db, {
    tenantId: input.tenantId,
    idempotencyKey: input.idempotencyKey,
    provider,
  });
  return { row: existing, replayed: true };
}

export async function findWhatsAppOutboundDeliveryById(
  db: DbClient,
  input: {
    tenantId: string;
    deliveryId: string;
    provider?: WhatsAppOutboundProvider;
  },
) {
  const provider = input.provider ?? "whatsapp_twilio";
  const result = await db.query<ChannelProviderDeliveryRow>(
    `select *
     from channel_provider_deliveries
     where tenant_id = $1
       and provider = $3
       and id = $2`,
    [input.tenantId, input.deliveryId, provider],
  );
  return result.rows[0] ?? null;
}

export async function listDueWhatsAppOutboundDeliveries(
  db: DbClient,
  input: {
    tenantId: string;
    dueAt: string;
    limit: number;
    provider?: WhatsAppOutboundProvider;
  },
) {
  const provider = input.provider ?? "whatsapp_twilio";
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new Error("La limite de reprise WhatsApp est invalide.");
  }
  const result = await db.query<ChannelProviderDeliveryRow>(
    `select *
     from channel_provider_deliveries
     where tenant_id = $1
       and provider = $3
       and attempts < max_attempts
       and next_attempt_at <= $2
       and (lease_id is null or lease_expires_at <= $2)
       and (
         status = 'reserved'
         or (
           status = 'failed'
           and retryable = true
           and failure_classification in ('temporary', 'rate_limit')
         )
     )
     order by next_attempt_at asc, created_at asc
     limit $4`,
    [input.tenantId, input.dueAt, provider, input.limit],
  );
  return result.rows;
}

export async function claimWhatsAppOutboundDeliveryAttempt(
  db: DbClient,
  input: {
    tenantId: string;
    deliveryId: string;
    leaseId: string;
    attemptedAt: string;
    leaseExpiresAt: string;
    provider?: WhatsAppOutboundProvider;
  },
) {
  const provider = input.provider ?? "whatsapp_twilio";
  const result = await db.query<ChannelProviderDeliveryRow>(
    `update channel_provider_deliveries
     set attempts = attempts + 1,
         last_attempted_at = $1,
         lease_id = $2,
         lease_expires_at = $3,
         updated_at = $1
     where tenant_id = $4
       and id = $5
       and provider = $6
       and attempts < max_attempts
       and next_attempt_at <= $1
       and (lease_id is null or lease_expires_at <= $1)
       and (
         status = 'reserved'
         or (
           status = 'failed'
           and retryable = true
           and failure_classification in ('temporary', 'rate_limit')
         )
       )
     returning *`,
    [
      input.attemptedAt,
      input.leaseId,
      input.leaseExpiresAt,
      input.tenantId,
      input.deliveryId,
      provider,
    ],
  );
  return result.rows[0] ?? null;
}

export async function findWhatsAppOutboundDeliveryByIdempotency(
  db: DbClient,
  input: {
    tenantId: string;
    idempotencyKey: string;
    provider?: WhatsAppOutboundProvider;
  },
) {
  const provider = input.provider ?? "whatsapp_twilio";
  const result = await db.query<ChannelProviderDeliveryRow>(
    `select *
     from channel_provider_deliveries
     where tenant_id = $1
       and provider = $3
       and idempotency_key = $2`,
    [input.tenantId, input.idempotencyKey, provider],
  );
  return result.rows[0] ?? null;
}

export async function finalizeClaimedWhatsAppOutboundDelivery(
  db: DbClient,
  input: {
    tenantId: string;
    deliveryId: string;
    status: Exclude<ChannelProviderDeliveryRow["status"], "reserved">;
    externalMessageId: string | null;
    failureClassification: ChannelProviderFailureClassification | null;
    safeErrorCode: string | null;
    retryable: boolean;
    nextAttemptAt: string;
    leaseId: string;
    updatedAt: string;
    provider?: WhatsAppOutboundProvider;
  },
) {
  const provider = input.provider ?? "whatsapp_twilio";
  const result = await db.query<ChannelProviderDeliveryRow>(
    `update channel_provider_deliveries
     set status = $1,
         external_message_id = $2,
         failure_classification = $3,
         safe_error_code = $4,
         retryable = $5,
         next_attempt_at = $6,
         lease_id = null,
         lease_expires_at = null,
         updated_at = $7
     where tenant_id = $8 and id = $9 and provider = $11
       and lease_id = $10
       and status in ('reserved', 'failed')
     returning *`,
    [
      input.status,
      input.externalMessageId,
      input.failureClassification,
      input.safeErrorCode,
      input.retryable,
      input.nextAttemptAt,
      input.updatedAt,
      input.tenantId,
      input.deliveryId,
      input.leaseId,
      provider,
    ],
  );
  return result.rows[0] ?? null;
}

export async function updateWhatsAppOutboundMessageState(
  db: DbClient,
  input: {
    tenantId: string;
    messageId: string;
    status: "pending" | "sent" | "delivered" | "failed";
    safeErrorCode: string | null;
  },
) {
  const result = await db.query<{ id: string }>(
    `update conversation_messages
     set status = $1, safe_error_code = $2
     where tenant_id = $3 and id = $4
       and direction = 'outbound'
       and status in ('pending', 'failed')
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

export async function findWhatsAppOutboundDeliveryForStatusUpdate(
  db: DbClient,
  input: {
    externalMessageId: string;
    provider?: WhatsAppOutboundProvider;
    endpointId?: string;
  },
) {
  const provider = input.provider ?? "whatsapp_twilio";
  const result = await db.query<ChannelProviderDeliveryRow>(
    `select *
     from channel_provider_deliveries
     where provider = $2
       and external_message_id = $1
       and ($3::text is null or endpoint_id = $3)
     for update`,
    [input.externalMessageId, provider, input.endpointId ?? null],
  );
  return result.rows[0] ?? null;
}

export async function reserveWhatsAppOutboundDeliveryEvent(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    deliveryId: string;
    eventKey: string;
    status: ChannelProviderDeliveryEventRow["status"];
    safeErrorCode: string | null;
    receivedAt: string;
    provider?: WhatsAppOutboundProvider;
  },
) {
  const provider = input.provider ?? "whatsapp_twilio";
  const inserted = await db.query<ChannelProviderDeliveryEventRow>(
    `insert into channel_provider_delivery_events (
       id, tenant_id, delivery_id, provider, event_key, status,
       safe_error_code, received_at
     ) values ($1, $2, $3, $8, $4, $5, $6, $7)
     on conflict (provider, event_key) do nothing
     returning *`,
    [
      input.id,
      input.tenantId,
      input.deliveryId,
      input.eventKey,
      input.status,
      input.safeErrorCode,
      input.receivedAt,
      provider,
    ],
  );
  if (inserted.rows[0]) {
    return { row: inserted.rows[0], replayed: false };
  }

  const existing = await db.query<ChannelProviderDeliveryEventRow>(
    `select *
     from channel_provider_delivery_events
     where tenant_id = $1
       and delivery_id = $2
       and provider = $4
       and event_key = $3`,
    [input.tenantId, input.deliveryId, input.eventKey, provider],
  );
  return { row: existing.rows[0] ?? null, replayed: true };
}

export async function updateWhatsAppOutboundDeliveryFromStatus(
  db: DbClient,
  input: {
    tenantId: string;
    deliveryId: string;
    externalMessageId: string;
    status: "accepted" | "delivered" | "failed";
    safeErrorCode: string | null;
    updatedAt: string;
    provider?: WhatsAppOutboundProvider;
  },
) {
  const provider = input.provider ?? "whatsapp_twilio";
  const failed = input.status === "failed";
  const result = await db.query<ChannelProviderDeliveryRow>(
    `update channel_provider_deliveries
     set status = $1,
         failure_classification = $2,
         safe_error_code = $3,
         retryable = false,
         next_attempt_at = $4,
         lease_id = null,
         lease_expires_at = null,
         updated_at = $4
     where tenant_id = $5
       and id = $6
       and provider = $8
       and external_message_id = $7
     returning *`,
    [
      input.status,
      failed ? "permanent" : null,
      input.safeErrorCode,
      input.updatedAt,
      input.tenantId,
      input.deliveryId,
      input.externalMessageId,
      provider,
    ],
  );
  return result.rows[0] ?? null;
}

export async function updateWhatsAppOutboundMessageFromStatus(
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
     where tenant_id = $3
       and id = $4
       and direction = 'outbound'
       and (
         ($1 = 'sent' and status = 'pending')
         or ($1 = 'delivered' and status in ('pending', 'sent', 'failed'))
         or ($1 = 'failed' and status in ('pending', 'sent'))
       )
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
