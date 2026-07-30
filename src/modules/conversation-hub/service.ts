import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import type { Role } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import { ConversationHubError } from "@/modules/conversation-hub/errors";
import {
  findConversationIdentityByExternalSubject,
  findConversationMessageByIdempotencyKey,
  findConversationThreadRow,
  insertConversationAttachment,
  insertConversationIdentityIfAbsent,
  insertConversationMessageIfAbsent,
  insertConversationParticipantIfAbsent,
  insertConversationRouteHop,
  insertConversationThread,
  insertThreadParticipantIfAbsent,
  listConversationAttachmentRows,
  listConversationIdentityRows,
  listConversationMessageRows,
  listConversationRouteHopRows,
  updateConversationThreadLastMessage,
  type ConversationChannelIdentityRow,
  type ConversationMessageRow,
} from "@/modules/conversation-hub/repository";
import {
  conversationThreadLookupSchema,
  messageIngressSchema,
  type MessageIngress,
} from "@/modules/conversation-hub/schemas";
import { assertTenantAccess } from "@/modules/tenants";

const conversationWriteRoles: Role[] = [
  "owner",
  "administrator",
  "manager",
  "collaborator",
];

export async function ingestConversationMessage(
  db: DbClient,
  userId: string,
  input: MessageIngress,
) {
  const parsed = messageIngressSchema.parse(input);

  return withTenantDbTransaction(
    db,
    parsed.tenantId,
    userId,
    async (transaction) => {
      await assertTenantAccess(
        transaction,
        userId,
        parsed.tenantId,
        conversationWriteRoles,
      );

      const replay = await findConversationMessageByIdempotencyKey(
        transaction,
        parsed.tenantId,
        parsed.idempotencyKey,
      );
      if (replay) {
        assertReplayMatchesIngress(replay, parsed);
        await auditReplay(transaction, userId, replay);
        return ingressResult(replay, true);
      }

      const identity = await ensureConversationIdentity(transaction, parsed);
      const thread = await ensureConversationThread(
        transaction,
        parsed.tenantId,
        parsed.threadId,
      );
      const createdAt = nowIso();
      await insertThreadParticipantIfAbsent(transaction, {
        tenantId: parsed.tenantId,
        threadId: thread.id,
        channelIdentityId: identity.id,
        joinedAt: createdAt,
      });

      const message = await insertConversationMessageIfAbsent(transaction, {
        id: id("conversation_message"),
        tenantId: parsed.tenantId,
        threadId: thread.id,
        channelIdentityId: identity.id,
        direction: "inbound",
        kind: "text",
        status: "received",
        textContent: parsed.text ?? null,
        adapterKey: identity.adapter_key,
        externalMessageId: parsed.externalMessageId,
        idempotencyKey: parsed.idempotencyKey,
        correlationId: parsed.correlationId,
        causationId: parsed.causationId ?? null,
        occurredAt: parsed.occurredAt,
        createdAt,
      });

      if (!message) {
        const concurrentReplay = await findConversationMessageByIdempotencyKey(
          transaction,
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        if (!concurrentReplay) {
          throw new ConversationHubError(
            "conversation_idempotency_conflict",
            "Le message existe déjà mais ne peut pas être relu.",
          );
        }
        assertReplayMatchesIngress(concurrentReplay, parsed);
        await auditReplay(transaction, userId, concurrentReplay);
        return ingressResult(concurrentReplay, true);
      }

      for (const attachment of parsed.attachments) {
        await insertConversationAttachment(transaction, {
          id: attachment.id,
          tenantId: parsed.tenantId,
          messageId: message.id,
          kind: attachment.kind,
          fileName: attachment.fileName,
          mediaType: attachment.mediaType,
          sizeBytes: attachment.sizeBytes,
          storageReference: attachment.storageReference,
          checksumSha256: attachment.checksumSha256,
          createdAt,
        });
      }
      for (const [position, hop] of parsed.routeTrace.entries()) {
        await insertConversationRouteHop(transaction, {
          tenantId: parsed.tenantId,
          messageId: message.id,
          position,
          adapterKey: hop.adapterKey,
          channelIdentityId: hop.channelIdentityId,
          externalMessageId: hop.externalMessageId ?? null,
        });
      }
      await updateConversationThreadLastMessage(transaction, {
        tenantId: parsed.tenantId,
        threadId: thread.id,
        occurredAt: parsed.occurredAt,
        updatedAt: createdAt,
      });
      await recordAuditLog(transaction, {
        tenantId: parsed.tenantId,
        actorId: userId,
        action: "conversation.message_received",
        targetType: "conversation_message",
        targetId: message.id,
        metadata: {
          threadId: thread.id,
          direction: message.direction,
          status: message.status,
          attachmentCount: parsed.attachments.length,
          idempotentReplay: false,
        },
      });

      return ingressResult(message, false);
    },
  );
}

export async function getConversationThread(
  db: DbClient,
  userId: string,
  tenantId: string,
  threadId: string,
  messageLimit = 100,
) {
  return withTenantDbTransaction(db, tenantId, userId, (transaction) =>
    readConversationThread(
      transaction,
      userId,
      tenantId,
      threadId,
      messageLimit,
    ),
  );
}

async function readConversationThread(
  db: DbClient,
  userId: string,
  tenantId: string,
  threadId: string,
  messageLimit: number,
) {
  await assertTenantAccess(db, userId, tenantId);
  const parsed = conversationThreadLookupSchema.parse({ threadId, messageLimit });
  const thread = await findConversationThreadRow(db, tenantId, parsed.threadId);
  if (!thread) {
    throw new ConversationHubError(
      "conversation_thread_not_found",
      "Conversation introuvable.",
    );
  }

  const [identities, messages] = await Promise.all([
    listConversationIdentityRows(db, tenantId, thread.id),
    listConversationMessageRows(db, tenantId, thread.id, parsed.messageLimit),
  ]);
  const messageIds = messages.map((message) => message.id);
  const [attachments, routeHops] = await Promise.all([
    listConversationAttachmentRows(db, tenantId, messageIds),
    listConversationRouteHopRows(db, tenantId, messageIds),
  ]);

  const attachmentsByMessage = groupByMessage(attachments);
  const routeHopsByMessage = groupByMessage(routeHops);

  return {
    id: thread.id,
    tenantId: thread.tenant_id,
    status: thread.status,
    subject: thread.subject ?? undefined,
    participantIdentityIds: identities.map((identity) => identity.id),
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
    lastMessageAt: thread.last_message_at ?? undefined,
    identities: identities.map(mapIdentity),
    messages: messages.map((message) => ({
      id: message.id,
      tenantId: message.tenant_id,
      threadId: message.thread_id,
      direction: message.direction,
      kind: message.kind,
      status: message.status,
      text: message.text_content ?? undefined,
      attachments: (attachmentsByMessage.get(message.id) ?? []).map(
        (attachment) => ({
          id: attachment.id,
          kind: attachment.kind,
          fileName: attachment.file_name,
          mediaType: attachment.media_type,
          sizeBytes: attachment.size_bytes,
          storageReference: attachment.storage_reference,
          checksumSha256: attachment.checksum_sha256,
        }),
      ),
      provenance: {
        channelIdentityId: message.channel_identity_id,
        adapterKey: message.adapter_key,
        externalMessageId: message.external_message_id ?? undefined,
        idempotencyKey: message.idempotency_key,
        correlationId: message.correlation_id,
        causationId: message.causation_id ?? undefined,
        routeTrace: (routeHopsByMessage.get(message.id) ?? []).map((hop) => ({
          adapterKey: hop.adapter_key,
          channelIdentityId: hop.channel_identity_id,
          externalMessageId: hop.external_message_id ?? undefined,
        })),
      },
      occurredAt: message.occurred_at,
      createdAt: message.created_at,
    })),
  };
}

async function ensureConversationIdentity(db: DbClient, input: MessageIngress) {
  const existing = await findConversationIdentityByExternalSubject(
    db,
    input.tenantId,
    input.channelIdentity.adapterKey,
    input.channelIdentity.externalSubjectId,
  );
  if (existing) {
    assertIdentityMatchesIngress(existing, input);
    if (existing.state === "blocked" || existing.state === "revoked") {
      throw new ConversationHubError(
        "conversation_identity_unavailable",
        "Cette identité de canal ne peut pas recevoir de message.",
      );
    }
    return existing;
  }

  if (
    input.channelIdentity.state === "blocked" ||
    input.channelIdentity.state === "revoked"
  ) {
    throw new ConversationHubError(
      "conversation_identity_unavailable",
      "Cette identité de canal ne peut pas recevoir de message.",
    );
  }

  await insertConversationParticipantIfAbsent(db, {
    id: input.channelIdentity.participantId,
    tenantId: input.tenantId,
    role: input.channelIdentity.role,
    displayName: input.channelIdentity.displayName ?? null,
    createdAt: input.channelIdentity.createdAt,
    updatedAt: input.channelIdentity.updatedAt,
  });
  await insertConversationIdentityIfAbsent(db, {
    id: input.channelIdentity.id,
    tenantId: input.tenantId,
    participantId: input.channelIdentity.participantId,
    channelKind: input.channelIdentity.channelKind,
    adapterKey: input.channelIdentity.adapterKey,
    externalSubjectId: input.channelIdentity.externalSubjectId,
    displayName: input.channelIdentity.displayName ?? null,
    role: input.channelIdentity.role,
    state: input.channelIdentity.state,
    createdAt: input.channelIdentity.createdAt,
    updatedAt: input.channelIdentity.updatedAt,
  });

  const inserted = await findConversationIdentityByExternalSubject(
    db,
    input.tenantId,
    input.channelIdentity.adapterKey,
    input.channelIdentity.externalSubjectId,
  );
  if (!inserted) {
    throw new ConversationHubError(
      "conversation_identity_conflict",
      "L'identité de canal ne peut pas être créée.",
    );
  }
  assertIdentityMatchesIngress(inserted, input);
  return inserted;
}

function assertIdentityMatchesIngress(
  identity: ConversationChannelIdentityRow,
  input: MessageIngress,
) {
  if (
    identity.id !== input.channelIdentity.id ||
    identity.participant_id !== input.channelIdentity.participantId ||
    identity.channel_kind !== input.channelIdentity.channelKind ||
    identity.role !== input.channelIdentity.role
  ) {
    throw new ConversationHubError(
      "conversation_identity_conflict",
      "L'identité de canal ne correspond pas à l'identité enregistrée.",
    );
  }
}

async function ensureConversationThread(
  db: DbClient,
  tenantId: string,
  requestedThreadId?: string,
) {
  if (requestedThreadId) {
    const existing = await findConversationThreadRow(
      db,
      tenantId,
      requestedThreadId,
    );
    if (!existing) {
      throw new ConversationHubError(
        "conversation_thread_not_found",
        "Conversation introuvable.",
      );
    }
    return existing;
  }

  const now = nowIso();
  const threadId = id("conversation_thread");
  await insertConversationThread(db, {
    id: threadId,
    tenantId,
    status: "open",
    subject: null,
    createdAt: now,
    updatedAt: now,
  });
  const created = await findConversationThreadRow(db, tenantId, threadId);
  if (!created) {
    throw new ConversationHubError(
      "conversation_thread_not_found",
      "La conversation créée ne peut pas être relue.",
    );
  }
  return created;
}

async function auditReplay(
  db: DbClient,
  userId: string,
  message: ConversationMessageRow,
) {
  await recordAuditLog(db, {
    tenantId: message.tenant_id,
    actorId: userId,
    action: "conversation.message_replayed",
    targetType: "conversation_message",
    targetId: message.id,
    metadata: {
      threadId: message.thread_id,
      direction: message.direction,
      status: message.status,
      idempotentReplay: true,
    },
  });
}

function assertReplayMatchesIngress(
  message: ConversationMessageRow,
  input: MessageIngress,
) {
  if (
    message.channel_identity_id !== input.channelIdentity.id ||
    message.adapter_key !== input.channelIdentity.adapterKey ||
    message.external_message_id !== input.externalMessageId ||
    (input.threadId !== undefined && message.thread_id !== input.threadId) ||
    message.text_content !== (input.text ?? null) ||
    message.correlation_id !== input.correlationId ||
    message.causation_id !== (input.causationId ?? null) ||
    message.occurred_at !== input.occurredAt
  ) {
    throw new ConversationHubError(
      "conversation_idempotency_conflict",
      "La clé d'idempotence correspond à un autre message.",
    );
  }
}

function ingressResult(message: ConversationMessageRow, replay: boolean) {
  return {
    threadId: message.thread_id,
    messageId: message.id,
    status: message.status,
    idempotentReplay: replay,
  };
}

function mapIdentity(identity: ConversationChannelIdentityRow) {
  return {
    id: identity.id,
    tenantId: identity.tenant_id,
    participantId: identity.participant_id,
    channelKind: identity.channel_kind,
    adapterKey: identity.adapter_key,
    externalSubjectId: identity.external_subject_id,
    displayName: identity.display_name ?? undefined,
    role: identity.role,
    state: identity.state,
    createdAt: identity.created_at,
    updatedAt: identity.updated_at,
  };
}

function groupByMessage<T extends { message_id: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const group = grouped.get(row.message_id) ?? [];
    group.push(row);
    grouped.set(row.message_id, group);
  }
  return grouped;
}
