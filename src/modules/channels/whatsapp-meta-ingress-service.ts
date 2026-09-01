import { createHmac } from "node:crypto";
import { withSystemDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import {
  prepareVerifiedMetaWhatsAppInboundMessages,
  type PreparedMetaWhatsAppInboundMessage,
} from "@/modules/channels/whatsapp-meta-adapter";
import { reserveMetaWhatsAppIdentityBinding } from "@/modules/channels/channel-provider-identity-bindings-repository";
import { resolveActiveMetaWhatsAppEndpoint } from "@/modules/channels/provider-endpoints-service";
import { ingestSystemConversationMessage } from "@/modules/conversation-hub";

const systemActorId = "system_whatsapp_meta";

export async function receivePreparedMetaWhatsAppWebhook(
  db: DbClient,
  input: unknown,
  configuration: {
    appSecret: string | undefined;
    fingerprintSecret: string | undefined;
    receivedAt?: string;
  },
) {
  const prepared = prepareVerifiedMetaWhatsAppInboundMessages(
    input,
    configuration.appSecret,
    configuration.receivedAt ?? nowIso(),
  );
  if (!prepared.ok) return { accepted: false as const, code: prepared.code };

  try {
    return await withSystemDbTransaction(db, async (transaction) => {
      const resolved = [];
      for (const message of prepared.messages) {
        const endpoint = await resolveActiveMetaWhatsAppEndpoint(
          transaction,
          {
            externalAccountId: message.safeAccountReference,
            phoneNumberId: message.recipientAddress.replace("whatsapp:+", ""),
          },
          configuration.fingerprintSecret,
        );
        if (!endpoint) {
          throw new MetaInboundMessageBatchRejection(
            "channel_provider_endpoint_not_found",
          );
        }

        const subject = fingerprintSubject(
          endpoint.tenantId,
          endpoint.endpointId,
          message.senderAddress,
          configuration.fingerprintSecret,
        );
        resolved.push({
          endpoint,
          identityId: `meta_identity_${subject.slice(0, 32)}`,
          message,
          subject,
        });
      }

      const outcomes = [];
      for (const { endpoint, identityId, message, subject } of resolved) {
        outcomes.push(
          await persistPreparedMetaWhatsAppMessage(transaction, {
            endpoint,
            identityId,
            message,
            subject,
          }),
        );
      }

      const first = outcomes[0];
      if (!first) {
        throw new Error("Le lot de messages WhatsApp Meta est vide.");
      }
      return {
        accepted: true as const,
        processed: outcomes.length,
        replayed: outcomes.every((outcome) => outcome.replayed),
        replayedCount: outcomes.filter((outcome) => outcome.replayed).length,
        messages: outcomes,
        messageId: first.messageId,
        threadId: first.threadId,
        tenantId: first.tenantId,
      };
    });
  } catch (error) {
    if (error instanceof MetaInboundMessageBatchRejection) {
      return { accepted: false as const, code: error.code };
    }
    throw error;
  }
}

async function persistPreparedMetaWhatsAppMessage(
  transaction: DbClient,
  input: {
    endpoint: { endpointId: string; tenantId: string };
    identityId: string;
    message: PreparedMetaWhatsAppInboundMessage;
    subject: string;
  },
) {
  const { endpoint, identityId, message, subject } = input;
  const result = await ingestSystemConversationMessage(transaction, systemActorId, {
    tenantId: endpoint.tenantId,
    threadId: `conversation_thread_meta_${subject.slice(0, 32)}`,
    channelIdentity: {
      id: identityId,
      tenantId: endpoint.tenantId,
      participantId: `meta_participant_${subject.slice(0, 32)}`,
      channelKind: "messaging",
      adapterKey: "whatsapp-meta",
      externalSubjectId: `meta_subject_${subject}`,
      displayName: "Contact WhatsApp",
      role: "customer",
      state: "active",
      createdAt: message.receivedAt,
      updatedAt: message.receivedAt,
    },
    externalMessageId: message.externalMessageId,
    idempotencyKey: message.idempotencyKey,
    correlationId: message.correlationId,
    routeTrace: [{
      adapterKey: "whatsapp-meta",
      channelIdentityId: identityId,
      externalMessageId: message.externalMessageId,
    }],
    text: message.text,
    attachments: [],
    occurredAt: message.receivedAt,
  });
  const binding = await reserveMetaWhatsAppIdentityBinding(transaction, {
    id: id("channel_identity_binding"),
    tenantId: endpoint.tenantId,
    endpointId: endpoint.endpointId,
    channelIdentityId: identityId,
    createdAt: message.receivedAt,
  });
  if (!binding.replayed) {
    await recordAuditLog(transaction, {
      tenantId: endpoint.tenantId,
      actorId: systemActorId,
      action: "channel.provider_identity_bound",
      targetType: "channel_provider_identity_binding",
      targetId: binding.row.id,
      metadata: {
        provider: "whatsapp_meta",
        contentStoredInAudit: false,
        providerReferenceStoredInAudit: false,
      },
    });
  }
  return {
    replayed: result.idempotentReplay,
    messageId: result.messageId,
    threadId: result.threadId,
    tenantId: endpoint.tenantId,
  };
}

class MetaInboundMessageBatchRejection extends Error {
  constructor(readonly code: "channel_provider_endpoint_not_found") {
    super("Le lot de messages WhatsApp Meta est refusé.");
    this.name = "MetaInboundMessageBatchRejection";
  }
}

function fingerprintSubject(
  tenantId: string,
  endpointId: string,
  senderAddress: string,
  fingerprintSecret: string | undefined,
) {
  if (!fingerprintSecret || fingerprintSecret.length < 32) {
    throw new Error("Channel fingerprinting is not configured.");
  }
  return createHmac("sha256", fingerprintSecret)
    .update(`v2:whatsapp_meta_subject:${tenantId}:${endpointId}:${senderAddress}`)
    .digest("hex");
}
