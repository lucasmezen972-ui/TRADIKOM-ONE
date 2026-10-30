import { z } from "zod";
import type { DbClient } from "@/lib/db";
import { hashToken } from "@/lib/security";
import {
  correlationIdSchema,
  idempotencyKeySchema,
} from "@/modules/conversation-hub/schemas";
import { ingestConversationMessage } from "@/modules/conversation-hub/service";

export const testChannelMessageSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(160),
    threadId: z.string().trim().min(1).max(160).optional(),
    externalSubjectId: z.string().trim().min(1).max(256),
    displayName: z.string().trim().min(1).max(160).default("Canal de test"),
    externalMessageId: z.string().trim().min(1).max(256),
    idempotencyKey: idempotencyKeySchema,
    correlationId: correlationIdSchema,
    text: z.string().trim().min(1).max(16_000),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type TestChannelMessage = z.infer<typeof testChannelMessageSchema>;

export function createTestChannelAdapter(db: DbClient) {
  return {
    key: "canal-test" as const,
    kind: "test" as const,
    async ingest(userId: string, input: TestChannelMessage) {
      const parsed = testChannelMessageSchema.parse(input);
      const identityFingerprint = hashToken(
        `${parsed.tenantId}:${parsed.externalSubjectId}`,
      ).slice(0, 32);
      const identityId = `test_identity_${identityFingerprint}`;
      const participantId = `test_participant_${identityFingerprint}`;

      return ingestConversationMessage(db, userId, {
        tenantId: parsed.tenantId,
        threadId: parsed.threadId,
        channelIdentity: {
          id: identityId,
          tenantId: parsed.tenantId,
          participantId,
          channelKind: "test",
          adapterKey: "canal-test",
          externalSubjectId: parsed.externalSubjectId,
          displayName: parsed.displayName,
          role: "customer",
          state: "active",
          createdAt: parsed.occurredAt,
          updatedAt: parsed.occurredAt,
        },
        externalMessageId: parsed.externalMessageId,
        idempotencyKey: parsed.idempotencyKey,
        correlationId: parsed.correlationId,
        routeTrace: [
          {
            adapterKey: "canal-test",
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
