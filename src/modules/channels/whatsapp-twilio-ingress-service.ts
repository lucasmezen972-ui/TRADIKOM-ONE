import { createHmac } from "node:crypto";
import { withSystemDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { nowIso } from "@/lib/security";
import {
  prepareVerifiedWhatsAppInboundMessage,
  type WhatsAppInboundPreparationResult,
} from "@/modules/channels/whatsapp-twilio-adapter";
import { resolveActiveWhatsAppEndpoint } from "@/modules/channels/provider-endpoints-service";
import { ingestSystemConversationMessage } from "@/modules/conversation-hub";

const systemActorId = "system_whatsapp_twilio";

export async function receivePreparedWhatsAppWebhook(
  db: DbClient,
  input: unknown,
  configuration: {
    authToken: string | undefined;
    fingerprintSecret: string | undefined;
    receivedAt?: string;
  },
) {
  const prepared = prepareVerifiedWhatsAppInboundMessage(
    input,
    configuration.authToken,
    configuration.receivedAt ?? nowIso(),
  );
  if (!prepared.ok) return rejectedPreparation(prepared);

  return withSystemDbTransaction(db, async (transaction) => {
    const endpoint = await resolveActiveWhatsAppEndpoint(
      transaction,
      {
        externalAccountId: prepared.message.safeAccountReference,
        destinationAddress: prepared.message.recipientAddress,
      },
      configuration.fingerprintSecret,
    );
    if (!endpoint) {
      return {
        accepted: false as const,
        code: "channel_provider_endpoint_not_found" as const,
      };
    }

    const subjectFingerprint = fingerprintWhatsAppSubject(
      endpoint.tenantId,
      prepared.message.senderAddress,
      configuration.fingerprintSecret,
    );
    const identityId = `whatsapp_identity_${subjectFingerprint.slice(0, 32)}`;
    const participantId = `whatsapp_participant_${subjectFingerprint.slice(0, 32)}`;
    const result = await ingestSystemConversationMessage(
      transaction,
      systemActorId,
      {
        tenantId: endpoint.tenantId,
        channelIdentity: {
          id: identityId,
          tenantId: endpoint.tenantId,
          participantId,
          channelKind: "messaging",
          adapterKey: "whatsapp-twilio",
          externalSubjectId: `whatsapp_subject_${subjectFingerprint}`,
          displayName: "Contact WhatsApp",
          role: "customer",
          state: "active",
          createdAt: prepared.message.receivedAt,
          updatedAt: prepared.message.receivedAt,
        },
        externalMessageId: prepared.message.externalMessageId,
        idempotencyKey: prepared.message.idempotencyKey,
        correlationId: prepared.message.correlationId,
        routeTrace: [
          {
            adapterKey: "whatsapp-twilio",
            channelIdentityId: identityId,
            externalMessageId: prepared.message.externalMessageId,
          },
        ],
        text: canonicalWhatsAppText(prepared.message),
        attachments: [],
        occurredAt: prepared.message.receivedAt,
      },
    );

    return {
      accepted: true as const,
      replayed: result.idempotentReplay,
      messageId: result.messageId,
      threadId: result.threadId,
      tenantId: endpoint.tenantId,
    };
  });
}

function rejectedPreparation(
  result: Extract<WhatsAppInboundPreparationResult, { ok: false }>,
) {
  return { accepted: false as const, code: result.code };
}

function fingerprintWhatsAppSubject(
  tenantId: string,
  senderAddress: string,
  fingerprintSecret: string | undefined,
) {
  if (!fingerprintSecret || fingerprintSecret.length < 32) {
    throw new Error("Channel fingerprinting is not configured.");
  }
  return createHmac("sha256", fingerprintSecret)
    .update(`v1:whatsapp_subject:${tenantId}:${senderAddress}`)
    .digest("hex");
}

function canonicalWhatsAppText(
  message: Extract<WhatsAppInboundPreparationResult, { ok: true }>["message"],
) {
  if (message.media.length === 0) return message.text;
  const mediaNotice = `${message.media.length} média${
    message.media.length > 1 ? "s" : ""
  } WhatsApp en attente d’import.`;
  return message.text ? `${message.text}\n\n${mediaNotice}` : mediaNotice;
}
