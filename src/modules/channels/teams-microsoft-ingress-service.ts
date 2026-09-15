import { createHmac } from "node:crypto";
import { z } from "zod";
import { withSystemDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import {
  preparedTeamsInboundMessageSchema,
  type PreparedTeamsInboundMessage,
} from "@/modules/channels/teams-microsoft-webhook";
import { resolveActiveTeamsEndpoint } from "@/modules/channels/provider-endpoints-service";
import { ingestSystemConversationMessage } from "@/modules/conversation-hub";

const microsoftClientIdSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const fingerprintSecretSchema = z.string().min(32).max(512);
const systemActorId = "system_teams_microsoft";

export async function ingestPreparedTeamsMessage(
  db: DbClient,
  input: PreparedTeamsInboundMessage,
  configuration: {
    clientId: string | undefined;
    fingerprintSecret: string | undefined;
  },
) {
  const message = preparedTeamsInboundMessageSchema.parse(input);
  const clientId = microsoftClientIdSchema.parse(configuration.clientId);
  const secret = fingerprintSecretSchema.parse(
    configuration.fingerprintSecret,
  );

  return withSystemDbTransaction(db, async (transaction) => {
    const endpoint = await resolveActiveTeamsEndpoint(
      transaction,
      {
        externalAccountId: clientId,
        microsoftTenantId: message.microsoftTenantId,
      },
      secret,
    );
    if (!endpoint) {
      return {
        accepted: false as const,
        code: "channel_provider_endpoint_not_found" as const,
      };
    }

    const identityFingerprint = fingerprintTeamsReference(
      "identity",
      endpoint.tenantId,
      message.senderSubject,
      secret,
    );
    const threadFingerprint = fingerprintTeamsReference(
      "conversation",
      endpoint.tenantId,
      message.conversationSubject,
      secret,
    );
    const identityId = `teams_identity_${identityFingerprint.slice(0, 32)}`;
    const participantId = `teams_participant_${identityFingerprint.slice(0, 32)}`;
    const result = await ingestSystemConversationMessage(
      transaction,
      systemActorId,
      {
        tenantId: endpoint.tenantId,
        threadId: `conversation_thread_teams_${threadFingerprint.slice(0, 32)}`,
        channelIdentity: {
          id: identityId,
          tenantId: endpoint.tenantId,
          participantId,
          channelKind: "collaboration",
          adapterKey: "teams-microsoft",
          externalSubjectId: `teams_subject_${identityFingerprint}`,
          displayName: "Contact Microsoft Teams",
          role: "customer",
          state: "active",
          createdAt: message.receivedAt,
          updatedAt: message.receivedAt,
        },
        externalMessageId: message.externalMessageId,
        idempotencyKey: message.idempotencyKey,
        correlationId: message.correlationId,
        routeTrace: [
          {
            adapterKey: "teams-microsoft",
            channelIdentityId: identityId,
            externalMessageId: message.externalMessageId,
          },
        ],
        text: canonicalTeamsText(message),
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

function fingerprintTeamsReference(
  kind: "identity" | "conversation",
  tenantId: string,
  externalReference: string,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(`v1:teams_${kind}:${tenantId}:${externalReference}`)
    .digest("hex");
}

function canonicalTeamsText(message: PreparedTeamsInboundMessage) {
  if (message.attachmentCount === 0) return message.text;
  const attachmentNotice = `${message.attachmentCount} pièce${
    message.attachmentCount > 1 ? "s" : ""
  } jointe${message.attachmentCount > 1 ? "s" : ""} Teams en attente d’import.`;
  return message.text
    ? `${message.text}\n\n${attachmentNotice}`
    : attachmentNotice;
}

