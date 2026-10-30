import { z } from "zod";
import type { DbClient } from "@/lib/db";
import { hashToken } from "@/lib/security";
import {
  correlationIdSchema,
  idempotencyKeySchema,
} from "@/modules/conversation-hub/schemas";
import { ingestConversationMessage } from "@/modules/conversation-hub/service";

export const webChannelMessageSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(160),
    threadId: z.string().trim().min(1).max(160).optional(),
    displayName: z.string().trim().min(1).max(160),
    externalMessageId: z.string().trim().min(1).max(256),
    idempotencyKey: idempotencyKeySchema,
    correlationId: correlationIdSchema,
    text: z.string().trim().min(1).max(16_000),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type WebChannelMessage = z.infer<typeof webChannelMessageSchema>;

export function createWebChannelAdapter(db: DbClient) {
  return {
    key: "web-chat" as const,
    kind: "web" as const,
    async ingest(userId: string, input: WebChannelMessage) {
      const parsed = webChannelMessageSchema.parse(input);
      const identityFingerprint = hashToken(
        `${parsed.tenantId}:${userId}`,
      ).slice(0, 32);
      const identityId = `web_identity_${identityFingerprint}`;
      const participantId = `web_participant_${identityFingerprint}`;

      return ingestConversationMessage(db, userId, {
        tenantId: parsed.tenantId,
        threadId: parsed.threadId,
        channelIdentity: {
          id: identityId,
          tenantId: parsed.tenantId,
          participantId,
          channelKind: "web",
          adapterKey: "web-chat",
          externalSubjectId: userId,
          displayName: parsed.displayName,
          role: "member",
          state: "active",
          createdAt: parsed.occurredAt,
          updatedAt: parsed.occurredAt,
        },
        externalMessageId: parsed.externalMessageId,
        idempotencyKey: parsed.idempotencyKey,
        correlationId: parsed.correlationId,
        routeTrace: [
          {
            adapterKey: "web-chat",
            channelIdentityId: identityId,
            externalMessageId: parsed.externalMessageId,
          },
        ],
        text: parsed.text,
        attachments: [],
        occurredAt: parsed.occurredAt,
      });
    },
  };
}
