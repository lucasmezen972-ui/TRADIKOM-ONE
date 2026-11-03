import { ingestNativeConversationDocument } from "@/modules/conversation-hub/native-documents";
import { getDb, type DbClient } from "@/lib/db";
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
import { createConversationModelPlan, getConversationModelReadiness, type CreateModelPlanInput } from "@/modules/orchestrator/model-runtime";
import { createConversationContactTask, listConversationTaskContacts,
  type CreateConversationContactTaskInput } from "@/modules/conversation-hub/native-tasks";
import { createGoalWatch, changeGoalWatch, listGoalWatchesForThread,
  type CreateGoalWatchInput, type ChangeGoalWatchInput } from "@/modules/goal-watch";
import { inspectMetaWhatsAppTenantReadiness } from "@/modules/channels/provider-endpoints-service";
import {
  issueCurrentWhatsAppMetaTrialAuthorization,
  revokeCurrentWhatsAppMetaTrialAuthorization,
} from "@/modules/channels/whatsapp-meta-activation-authorization-service";
import {
  createConversationActionPlan,
  delegateConversationActionPlan,
  decideConversationActionPlan,
  executeConversationActionPlan,
  listConversationActionPlans,
  listConversationActionPlanDelegationTargets,
  requestConversationActionPlanRetry,
  reviseConversationActionPlan,
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
    modelReadiness: getConversationModelReadiness(),
    createModelPlan: (userId: string, tenantId: string, input: CreateModelPlanInput) =>
      createConversationModelPlan(db, userId, tenantId, input),
    createContactTaskFromConversation: (userId: string, tenantId: string, input: CreateConversationContactTaskInput) =>
      createConversationContactTask(db, userId, tenantId, input),
    prepareTaskForm: async (userId: string, tenantId: string, threadId: string) => ({
      contacts: await listConversationTaskContacts(db, userId, tenantId, threadId),
      dueAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    }),
    createGoalWatch: (userId: string, tenantId: string, input: CreateGoalWatchInput) =>
      createGoalWatch(db, userId, tenantId, input),
    changeGoalWatch: (userId: string, tenantId: string, input: ChangeGoalWatchInput) =>
      changeGoalWatch(db, userId, tenantId, input),
    listGoalWatches: (userId: string, tenantId: string, threadId: string) =>
      listGoalWatchesForThread(db, userId, tenantId, threadId),
    uploadDocument: (userId: string, input: Parameters<typeof ingestNativeConversationDocument>[2], file: { name: string; bytes: Uint8Array }) => ingestNativeConversationDocument(db, userId, input, file),
    web: createWebChannelAdapter(db),
    test: createTestChannelAdapter(db),
    getMetaWhatsAppTenantReadiness: (userId: string, tenantId: string) =>
      inspectMetaWhatsAppTenantReadiness(db, userId, tenantId),
    authorizeMetaWhatsAppTrial: (
      userId: string,
      tenantId: string,
      input: { idempotencyKey: string; freeUnitsConfirmed: true },
    ) =>
      issueCurrentWhatsAppMetaTrialAuthorization(db, {
        tenantId,
        actorId: userId,
        ...input,
      }),
    revokeMetaWhatsAppTrial: (userId: string, tenantId: string) =>
      revokeCurrentWhatsAppMetaTrialAuthorization(db, {
        tenantId,
        actorId: userId,
      }),
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
    listDelegationTargets: (
      userId: string,
      tenantId: string,
      planId: string,
    ) =>
      listConversationActionPlanDelegationTargets(
        db,
        userId,
        tenantId,
        planId,
      ),
    delegatePlan: (
      userId: string,
      tenantId: string,
      input: {
        planId: string;
        delegatedToUserId: string;
        expectedDelegationVersion: number;
        idempotencyKey: string;
        confirmed: true;
      },
    ) => delegateConversationActionPlan(db, userId, tenantId, input),
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
    revisePlan: (
      userId: string,
      tenantId: string,
      planId: string,
      taskTitle: string,
    ) =>
      reviseConversationActionPlan(db, userId, tenantId, {
        planId,
        taskTitle,
      }),
    executePlan: (userId: string, tenantId: string, planId: string) =>
      executeConversationActionPlan(db, userId, tenantId, planId),
    retryPlan: (userId: string, tenantId: string, planId: string) =>
      requestConversationActionPlanRetry(db, userId, tenantId, planId),
  };
}

export async function getConversationChannelServices() {
  const db = await getDb();
  return createConversationChannelServices(db);
}
