import { getDb, migrate, type DbClient } from "@/lib/db";
import {
  getConversationThread,
  listConversationThreads,
} from "@/modules/conversation-hub";
import { createTestChannelAdapter } from "@/modules/channels/test-channel";
import { createWebChannelAdapter } from "@/modules/channels/web-channel";
import {
  createConversationActionPlan,
  decideConversationActionPlan,
  listConversationActionPlans,
} from "@/modules/orchestrator";

export function createConversationChannelServices(db: DbClient) {
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
  };
}

export async function getConversationChannelServices() {
  const db = await getDb();
  await migrate(db);
  return createConversationChannelServices(db);
}
