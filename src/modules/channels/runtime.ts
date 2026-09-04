import { getDb, migrate, type DbClient } from "@/lib/db";
import {
  createUnavailableAttachmentAccessDependencies,
  getConversationThread,
  getAttachmentAccessRuntimeMode,
  listConversationThreads,
  prepareConversationAttachmentAccess,
  readConversationAttachment,
  type AttachmentAccessDependencies,
} from "@/modules/conversation-hub";
import { createTestChannelAdapter } from "@/modules/channels/test-channel";
import { createWebChannelAdapter } from "@/modules/channels/web-channel";
import {
  createConversationActionPlan,
  decideConversationActionPlan,
  executeConversationActionPlan,
  listConversationActionPlans,
  requestConversationActionPlanRetry,
} from "@/modules/orchestrator";

export type ConversationChannelServiceDependencies = {
  attachmentAccess?: AttachmentAccessDependencies;
};

export function createConversationChannelServices(
  db: DbClient,
  dependencies: ConversationChannelServiceDependencies = {},
) {
  const attachmentAccess =
    dependencies.attachmentAccess ??
    createUnavailableAttachmentAccessDependencies("not_configured");
  return {
    web: createWebChannelAdapter(db),
    test: createTestChannelAdapter(db),
    listThreads: (userId: string, tenantId: string, limit?: number) =>
      listConversationThreads(db, userId, tenantId, limit),
    getThread: (
      userId: string,
      tenantId: string,
      threadId: string,
      messageLimit?: number,
    ) =>
      getConversationThread(db, userId, tenantId, threadId, messageLimit),
    attachmentAccessState: getAttachmentAccessRuntimeMode(attachmentAccess),
    prepareAttachmentAccess: (
      userId: string,
      tenantId: string,
      attachmentId: string,
      ttlSeconds?: number,
    ) =>
      prepareConversationAttachmentAccess(
        db,
        userId,
        tenantId,
        { attachmentId, ...(ttlSeconds === undefined ? {} : { ttlSeconds }) },
        attachmentAccess,
      ),
    readAttachment: (
      userId: string,
      tenantId: string,
      attachmentId: string,
      ticket: string,
    ) =>
      readConversationAttachment(
        db,
        userId,
        tenantId,
        { attachmentId, ticket },
        attachmentAccess,
      ),
    createPlan: (
      userId: string,
      tenantId: string,
      threadId: string,
      sourceMessageId: string,
    ) =>
      createConversationActionPlan(db, userId, {
        tenantId,
        threadId,
        sourceMessageId,
      }),
    listPlans: (userId: string, tenantId: string, threadId: string) =>
      listConversationActionPlans(db, userId, tenantId, threadId),
    decidePlan: (
      userId: string,
      tenantId: string,
      planId: string,
      decision: "approved" | "rejected",
      reason: string,
    ) =>
      decideConversationActionPlan(db, userId, tenantId, {
        planId,
        decision,
        reason,
      }),
    executePlan: (userId: string, tenantId: string, planId: string) =>
      executeConversationActionPlan(db, userId, tenantId, planId),
    retryPlan: (userId: string, tenantId: string, planId: string) =>
      requestConversationActionPlanRetry(db, userId, tenantId, planId),
  };
}

export async function getConversationChannelServices() {
  const db = await getDb();
  await migrate(db);
  return createConversationChannelServices(db);
}
