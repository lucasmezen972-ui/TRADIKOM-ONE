import { createHmac } from "node:crypto";
import { withSystemDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { nowIso } from "@/lib/security";
import {
  prepareVerifiedMetaWhatsAppInboundMessage,
} from "@/modules/channels/whatsapp-meta-adapter";
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
  const prepared = prepareVerifiedMetaWhatsAppInboundMessage(
    input,
    configuration.appSecret,
    configuration.receivedAt ?? nowIso(),
  );
  if (!prepared.ok) return { accepted: false as const, code: prepared.code };

  return withSystemDbTransaction(db, async (transaction) => {
    const endpoint = await resolveActiveMetaWhatsAppEndpoint(
      transaction,
      {
        externalAccountId: prepared.message.safeAccountReference,
        phoneNumberId: prepared.message.recipientAddress.replace("whatsapp:+", ""),
      },
      configuration.fingerprintSecret,
    );
    if (!endpoint) {
      return { accepted: false as const, code: "channel_provider_endpoint_not_found" as const };
    }

    const subject = fingerprintSubject(
      endpoint.tenantId,
      prepared.message.senderAddress,
      configuration.fingerprintSecret,
    );
    const identityId = `meta_identity_${subject.slice(0, 32)}`;
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
        createdAt: prepared.message.receivedAt,
        updatedAt: prepared.message.receivedAt,
      },
      externalMessageId: prepared.message.externalMessageId,
      idempotencyKey: prepared.message.idempotencyKey,
      correlationId: prepared.message.correlationId,
      routeTrace: [{
        adapterKey: "whatsapp-meta",
        channelIdentityId: identityId,
        externalMessageId: prepared.message.externalMessageId,
      }],
      text: prepared.message.text,
      attachments: [],
      occurredAt: prepared.message.receivedAt,
    });
    return {
      accepted: true as const,
      replayed: result.idempotentReplay,
      messageId: result.messageId,
      threadId: result.threadId,
      tenantId: endpoint.tenantId,
    };
  });
}

function fingerprintSubject(
  tenantId: string,
  senderAddress: string,
  fingerprintSecret: string | undefined,
) {
  if (!fingerprintSecret || fingerprintSecret.length < 32) {
    throw new Error("Channel fingerprinting is not configured.");
  }
  return createHmac("sha256", fingerprintSecret)
    .update(`v1:whatsapp_meta_subject:${tenantId}:${senderAddress}`)
    .digest("hex");
}
