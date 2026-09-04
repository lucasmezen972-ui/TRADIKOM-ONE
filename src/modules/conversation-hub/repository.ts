import type { DbClient } from "@/lib/db";

export type ConversationParticipantRow = {
  id: string;
  tenant_id: string;
  role: "customer" | "member" | "assistant" | "system";
  display_name: string | null;
  created_at: string;
  updated_at: string;
};

export type ConversationChannelIdentityRow = {
  id: string;
  tenant_id: string;
  participant_id: string;
  channel_kind:
    | "web"
    | "messaging"
    | "email"
    | "voice"
    | "collaboration"
    | "test";
  adapter_key: string;
  external_subject_id: string;
  display_name: string | null;
  role: "customer" | "member" | "assistant" | "system";
  state: "active" | "unverified" | "blocked" | "revoked";
  created_at: string;
  updated_at: string;
};

export type ConversationThreadRow = {
  id: string;
  tenant_id: string;
  status: "open" | "awaiting_validation" | "resolved" | "archived";
  subject: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
};

export type ConversationMessageRow = {
  id: string;
  tenant_id: string;
  thread_id: string;
  channel_identity_id: string;
  direction: "inbound" | "outbound" | "internal";
  kind: "text" | "system" | "plan" | "approval" | "result";
  status: "received" | "pending" | "sent" | "delivered" | "failed";
  text_content: string | null;
  adapter_key: string;
  external_message_id: string | null;
  idempotency_key: string;
  correlation_id: string;
  causation_id: string | null;
  safe_error_code: string | null;
  occurred_at: string;
  created_at: string;
};

export type ConversationAttachmentRow = {
  id: string;
  tenant_id: string;
  message_id: string;
  kind: "document" | "image" | "audio" | "video" | "file";
  file_name: string;
  media_type: string;
  size_bytes: number;
  storage_reference: string;
  checksum_sha256: string;
  trust_boundary: "external_untrusted_data" | null;
  extractor_mode: "mock" | null;
  extractor_key: string | null;
  extracted_text: string | null;
  extracted_text_sha256: string | null;
  extracted_at: string | null;
  created_at: string;
};

export type ConversationRouteHopRow = {
  tenant_id: string;
  message_id: string;
  position: number;
  adapter_key: string;
  channel_identity_id: string;
  external_message_id: string | null;
};

export async function findConversationIdentityByExternalSubject(
  db: DbClient,
  tenantId: string,
  adapterKey: string,
  externalSubjectId: string,
) {
  const result = await db.query<ConversationChannelIdentityRow>(
    `select *
     from conversation_channel_identities
     where tenant_id = $1 and adapter_key = $2 and external_subject_id = $3`,
    [tenantId, adapterKey, externalSubjectId],
  );
  return result.rows[0] ?? null;
}

export async function insertConversationParticipantIfAbsent(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    role: ConversationParticipantRow["role"];
    displayName: string | null;
    createdAt: string;
    updatedAt: string;
  },
) {
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6)
     on conflict do nothing`,
    [
      input.id,
      input.tenantId,
      input.role,
      input.displayName,
      input.createdAt,
      input.updatedAt,
    ],
  );
}

export async function insertConversationIdentityIfAbsent(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    participantId: string;
    channelKind: ConversationChannelIdentityRow["channel_kind"];
    adapterKey: string;
    externalSubjectId: string;
    displayName: string | null;
    role: ConversationChannelIdentityRow["role"];
    state: ConversationChannelIdentityRow["state"];
    createdAt: string;
    updatedAt: string;
  },
) {
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict do nothing`,
    [
      input.id,
      input.tenantId,
      input.participantId,
      input.channelKind,
      input.adapterKey,
      input.externalSubjectId,
      input.displayName,
      input.role,
      input.state,
      input.createdAt,
      input.updatedAt,
    ],
  );
}

export async function findConversationThreadRow(
  db: DbClient,
  tenantId: string,
  threadId: string,
) {
  const result = await db.query<ConversationThreadRow>(
    `select * from conversation_threads where tenant_id = $1 and id = $2`,
    [tenantId, threadId],
  );
  return result.rows[0] ?? null;
}

export async function listConversationThreadRows(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const result = await db.query<ConversationThreadRow>(
    `select *
     from conversation_threads
     where tenant_id = $1
     order by coalesce(last_message_at, created_at) desc, id desc
     limit $2`,
    [tenantId, limit],
  );
  return result.rows;
}

export async function insertConversationThread(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    status: ConversationThreadRow["status"];
    subject: string | null;
    createdAt: string;
    updatedAt: string;
  },
) {
  await db.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6)`,
    [
      input.id,
      input.tenantId,
      input.status,
      input.subject,
      input.createdAt,
      input.updatedAt,
    ],
  );
}

export async function insertConversationThreadIfAbsent(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    status: ConversationThreadRow["status"];
    subject: string | null;
    createdAt: string;
    updatedAt: string;
  },
) {
  await db.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6)
     on conflict (id) do nothing`,
    [
      input.id,
      input.tenantId,
      input.status,
      input.subject,
      input.createdAt,
      input.updatedAt,
    ],
  );
}

export async function insertThreadParticipantIfAbsent(
  db: DbClient,
  input: {
    tenantId: string;
    threadId: string;
    channelIdentityId: string;
    joinedAt: string;
  },
) {
  await db.query(
    `insert into conversation_thread_participants (
       tenant_id, thread_id, channel_identity_id, joined_at
     ) values ($1, $2, $3, $4)
     on conflict do nothing`,
    [input.tenantId, input.threadId, input.channelIdentityId, input.joinedAt],
  );
}

export async function findConversationMessageByIdempotencyKey(
  db: DbClient,
  tenantId: string,
  idempotencyKey: string,
) {
  const result = await db.query<ConversationMessageRow>(
    `select *
     from conversation_messages
     where tenant_id = $1 and idempotency_key = $2`,
    [tenantId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function findConversationMessageRow(
  db: DbClient,
  tenantId: string,
  threadId: string,
  messageId: string,
) {
  const result = await db.query<ConversationMessageRow>(
    `select *
     from conversation_messages
     where tenant_id = $1 and thread_id = $2 and id = $3`,
    [tenantId, threadId, messageId],
  );
  return result.rows[0] ?? null;
}

export async function insertConversationMessageIfAbsent(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    threadId: string;
    channelIdentityId: string;
    direction: ConversationMessageRow["direction"];
    kind: ConversationMessageRow["kind"];
    status: ConversationMessageRow["status"];
    textContent: string | null;
    adapterKey: string;
    externalMessageId: string | null;
    idempotencyKey: string;
    correlationId: string;
    causationId: string | null;
    occurredAt: string;
    createdAt: string;
  },
) {
  const result = await db.query<ConversationMessageRow>(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, causation_id, occurred_at, created_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
     )
     on conflict (tenant_id, idempotency_key) do nothing
     returning *`,
    [
      input.id,
      input.tenantId,
      input.threadId,
      input.channelIdentityId,
      input.direction,
      input.kind,
      input.status,
      input.textContent,
      input.adapterKey,
      input.externalMessageId,
      input.idempotencyKey,
      input.correlationId,
      input.causationId,
      input.occurredAt,
      input.createdAt,
    ],
  );
  return result.rows[0] ?? null;
}

export async function insertConversationAttachment(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    messageId: string;
    kind: ConversationAttachmentRow["kind"];
    fileName: string;
    mediaType: string;
    sizeBytes: number;
    storageReference: string;
    checksumSha256: string;
    extraction?: {
      trustBoundary: "external_untrusted_data";
      extractorMode: "mock";
      extractorKey: string;
      text: string;
      textSha256: string;
      extractedAt: string;
    };
    createdAt: string;
  },
) {
  await db.query(
    `insert into conversation_message_attachments (
       id, tenant_id, message_id, kind, file_name, media_type, size_bytes,
       storage_reference, checksum_sha256, trust_boundary, extractor_mode,
       extractor_key, extracted_text, extracted_text_sha256, extracted_at,
       created_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
     )`,
    [
      input.id,
      input.tenantId,
      input.messageId,
      input.kind,
      input.fileName,
      input.mediaType,
      input.sizeBytes,
      input.storageReference,
      input.checksumSha256,
      input.extraction?.trustBoundary ?? null,
      input.extraction?.extractorMode ?? null,
      input.extraction?.extractorKey ?? null,
      input.extraction?.text ?? null,
      input.extraction?.textSha256 ?? null,
      input.extraction?.extractedAt ?? null,
      input.createdAt,
    ],
  );
}

export async function insertConversationRouteHop(
  db: DbClient,
  input: {
    tenantId: string;
    messageId: string;
    position: number;
    adapterKey: string;
    channelIdentityId: string;
    externalMessageId: string | null;
  },
) {
  await db.query(
    `insert into conversation_message_route_hops (
       tenant_id, message_id, position, adapter_key, channel_identity_id,
       external_message_id
     ) values ($1, $2, $3, $4, $5, $6)`,
    [
      input.tenantId,
      input.messageId,
      input.position,
      input.adapterKey,
      input.channelIdentityId,
      input.externalMessageId,
    ],
  );
}

export async function updateConversationThreadLastMessage(
  db: DbClient,
  input: {
    tenantId: string;
    threadId: string;
    occurredAt: string;
    updatedAt: string;
  },
) {
  await db.query(
    `update conversation_threads
     set created_at = case
           when created_at > $1 then $1
           else created_at
         end,
         last_message_at = case
           when last_message_at is null or last_message_at < $1 then $1
           else last_message_at
         end,
         updated_at = $2
     where tenant_id = $3 and id = $4`,
    [input.occurredAt, input.updatedAt, input.tenantId, input.threadId],
  );
}

export async function updateConversationThreadStatus(
  db: DbClient,
  input: {
    tenantId: string;
    threadId: string;
    status: ConversationThreadRow["status"];
    updatedAt: string;
  },
) {
  await db.query(
    `update conversation_threads
     set status = $1, updated_at = $2
     where tenant_id = $3 and id = $4`,
    [input.status, input.updatedAt, input.tenantId, input.threadId],
  );
}

export async function listConversationIdentityRows(
  db: DbClient,
  tenantId: string,
  threadId: string,
) {
  const result = await db.query<ConversationChannelIdentityRow>(
    `select identities.*
     from conversation_thread_participants as participants
     join conversation_channel_identities as identities
       on identities.tenant_id = participants.tenant_id
      and identities.id = participants.channel_identity_id
     where participants.tenant_id = $1 and participants.thread_id = $2
     order by participants.joined_at asc, identities.id asc`,
    [tenantId, threadId],
  );
  return result.rows;
}

export async function listConversationMessageRows(
  db: DbClient,
  tenantId: string,
  threadId: string,
  limit: number,
) {
  const result = await db.query<ConversationMessageRow>(
    `select *
     from conversation_messages
     where tenant_id = $1 and thread_id = $2
     order by occurred_at asc, created_at asc, id asc
     limit $3`,
    [tenantId, threadId, limit],
  );
  return result.rows;
}

export async function listConversationAttachmentRows(
  db: DbClient,
  tenantId: string,
  messageIds: string[],
) {
  if (messageIds.length === 0) return [];
  const placeholders = messageIds
    .map((_, index) => `$${index + 2}`)
    .join(", ");
  const result = await db.query<ConversationAttachmentRow>(
    `select *
     from conversation_message_attachments
     where tenant_id = $1 and message_id in (${placeholders})
     order by created_at asc, id asc`,
    [tenantId, ...messageIds],
  );
  return result.rows;
}

export async function listConversationRouteHopRows(
  db: DbClient,
  tenantId: string,
  messageIds: string[],
) {
  if (messageIds.length === 0) return [];
  const placeholders = messageIds
    .map((_, index) => `$${index + 2}`)
    .join(", ");
  const result = await db.query<ConversationRouteHopRow>(
    `select *
     from conversation_message_route_hops
     where tenant_id = $1 and message_id in (${placeholders})
     order by message_id asc, position asc`,
    [tenantId, ...messageIds],
  );
  return result.rows;
}
