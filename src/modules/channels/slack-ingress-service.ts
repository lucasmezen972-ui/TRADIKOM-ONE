import { createHmac } from "node:crypto";
import { z } from "zod";
import { withSystemDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { resolveActiveSlackEndpoint } from "@/modules/channels/provider-endpoints-service";
import {
  preparedSlackInboundMessageSchema,
  type PreparedSlackInboundMessage,
} from "@/modules/channels/slack-webhook";
import { ingestSystemConversationMessage } from "@/modules/conversation-hub";

const fingerprintSecretSchema = z.string().min(32).max(512);
const systemActorId = "system_slack";

export async function ingestPreparedSlackMessage(
  db: DbClient,
  input: PreparedSlackInboundMessage,
  fingerprintSecret: string | undefined,
) {
  const message = preparedSlackInboundMessageSchema.parse(input);
  const secret = fingerprintSecretSchema.parse(fingerprintSecret);

  return withSystemDbTransaction(db, async (transaction) => {
    const endpoint = await resolveActiveSlackEndpoint(
      transaction,
      {
        externalAccountId: message.appId,
        workspaceId: message.workspaceId,
      },
      secret,
    );
    if (!endpoint) {
      return {
        accepted: false as const,
        code: "channel_provider_endpoint_not_found" as const,
      };
    }

    const identityFingerprint = fingerprintSlackReference(
      "identity",
      endpoint.tenantId,
      message.senderSubject,
      secret,
    );
    const threadFingerprint = fingerprintSlackReference(
      "conversation",
      endpoint.tenantId,
      message.conversationSubject,
      secret,
    );
    const identityId = `slack_identity_${identityFingerprint.slice(0, 32)}`;
    const participantId = `slack_participant_${identityFingerprint.slice(0, 32)}`;
    const result = await ingestSystemConversationMessage(
      transaction,
      systemActorId,
      {
        tenantId: endpoint.tenantId,
        threadId: `conversation_thread_slack_${threadFingerprint.slice(0, 32)}`,
        channelIdentity: {
          id: identityId,
          tenantId: endpoint.tenantId,
          participantId,
          channelKind: "collaboration",
          adapterKey: "slack",
          externalSubjectId: `slack_subject_${identityFingerprint}`,
          displayName: "Contact Slack",
          role: "customer",
          state: "active",
          createdAt: message.receivedAt,
          updatedAt: message.receivedAt,
        },
        externalMessageId: message.externalEventId,
        idempotencyKey: message.idempotencyKey,
        correlationId: message.correlationId,
        routeTrace: [
          {
            adapterKey: "slack",
            channelIdentityId: identityId,
            externalMessageId: message.externalEventId,
          },
        ],
        text: canonicalSlackText(message),
        attachments: [],
        occurredAt: message.receivedAt,
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

function fingerprintSlackReference(
  kind: "identity" | "conversation",
  tenantId: string,
  externalReference: string,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(`v1:slack_${kind}:${tenantId}:${externalReference}`)
    .digest("hex");
}

function canonicalSlackText(message: PreparedSlackInboundMessage) {
  if (message.attachmentCount === 0) return message.text;
  const attachmentNotice = `${message.attachmentCount} fichier${
    message.attachmentCount > 1 ? "s" : ""
  } Slack en attente d’import.`;
  return message.text
    ? `${message.text}\n\n${attachmentNotice}`
    : attachmentNotice;
}

