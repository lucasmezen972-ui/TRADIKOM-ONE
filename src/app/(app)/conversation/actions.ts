"use server";

import { NativeDocumentError } from "@/modules/conversation-hub/native-documents";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeServerAction } from "@/lib/public-action";
import { requireTenantContext } from "@/lib/session";
import { getConversationChannelServices } from "@/modules/channels";
import { conversationModelMaximumCostMicroUsd } from "@/modules/orchestrator/model-runtime";

export async function createConversationModelPlanAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const result = await safeServerAction("conversation.model_plan", () => services.createModelPlan(user.id, tenant.id, {
    threadId: text(formData, "threadId"), sourceMessageId: text(formData, "sourceMessageId"),
    idempotencyKey: text(formData, "idempotencyKey"), dataTransferApproved: requiredConfirmation(formData, "modelConsent"),
    externalContextApproved: text(formData, "modelExternalConsent") === "true",
    maximumCostMicroUsd: conversationModelMaximumCostMicroUsd,
  }));
  revalidatePath("/conversation");
  redirect(conversationPlanRedirect(result.threadId,
    result.approvalStatus === "draft" ? "clarification" : "cree", result.id));
}

export async function createNativeConversationTaskAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const result = await safeServerAction("conversation.native_task", () => services.createContactTaskFromConversation(user.id, tenant.id, {
    threadId: text(formData, "threadId"), sourceMessageId: text(formData, "sourceMessageId"),
    contactId: text(formData, "contactId"), title: text(formData, "title"), dueAt: text(formData, "dueAt"),
    idempotencyKey: text(formData, "idempotencyKey"), teamVisibilityConfirmed: requiredConfirmation(formData, "teamVisibilityConfirmed"),
  }));
  revalidatePath("/conversation");
  revalidatePath("/contacts");
  redirect(`/conversation?fil=${encodeURIComponent(result.threadId)}`);
}

export async function createConversationGoalAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const goal = await safeServerAction("conversation.goal_create", () => services.createGoalWatch(user.id, tenant.id, {
    threadId: text(formData, "threadId"), title: text(formData, "title"),
    signal: z.enum(["contacts", "opportunities", "published_websites"]).parse(text(formData, "signal")),
    operator: z.enum(["gte", "lte"]).parse(text(formData, "operator")),
    target: z.coerce.number().int().nonnegative().parse(text(formData, "target")),
    cadenceMinutes: z.coerce.number().int().parse(text(formData, "cadenceMinutes")),
    consentConfirmed: requiredConfirmation(formData, "goalConsent"),
    idempotencyKey: text(formData, "idempotencyKey"),
  }));
  revalidatePath("/conversation");
  redirect(`/conversation?fil=${encodeURIComponent(goal.threadId)}`);
}

export async function changeConversationGoalAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const goal = await safeServerAction("conversation.goal_change", () => {
    const action = z.enum(["pause", "resume", "stop"]).parse(text(formData, "action"));
    if (action === "stop") requiredConfirmation(formData, "stopConfirmed");
    return services.changeGoalWatch(user.id, tenant.id, {
      goalId: text(formData, "goalId"), action,
      expectedVersion: z.coerce.number().int().nonnegative().parse(text(formData, "version")),
      ...(action === "resume" ? { consentConfirmed: requiredConfirmation(formData, "goalConsent") } : {}),
    });
  });
  revalidatePath("/conversation");
  redirect(`/conversation?fil=${encodeURIComponent(goal.threadId)}`);
}

export async function sendWebConversationMessageAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const result = await safeServerAction("conversation.web_ingest", async () => {
    const input = {
      tenantId: tenant.id,
      threadId: optionalText(formData, "threadId"),
      displayName: user.name,
      externalMessageId: text(formData, "externalMessageId"),
      idempotencyKey: text(formData, "idempotencyKey"),
      correlationId: text(formData, "correlationId"),
      text: text(formData, "message"),
      occurredAt: text(formData, "occurredAt"),
    };
    const file = formData.get("attachmentFile");
    if (file instanceof File && file.size > 0) {
      if (file.size > 512 * 1024) throw new NativeDocumentError();
      return services.uploadDocument(user.id, input, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
    return services.web.ingest(user.id, input);
  });
  revalidatePath("/conversation");
  redirect(`/conversation?fil=${encodeURIComponent(result.threadId)}&envoye=web`);
}

export async function sendTestChannelMessageAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const result = await safeServerAction("conversation.test_ingest", () =>
    services.test.ingest(user.id, {
      tenantId: tenant.id,
      threadId: text(formData, "threadId"),
      externalSubjectId: `demonstration-${user.id}`,
      displayName: "Canal de test",
      externalMessageId: text(formData, "externalMessageId"),
      idempotencyKey: text(formData, "idempotencyKey"),
      correlationId: text(formData, "correlationId"),
      text: text(formData, "message"),
      occurredAt: text(formData, "occurredAt"),
    }),
  );
  revalidatePath("/conversation");
  redirect(
    `/conversation?fil=${encodeURIComponent(result.threadId)}&envoye=test`,
  );
}

export async function createConversationPlanAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const result = await safeServerAction("conversation.plan_create", () =>
    services.createPlan(
      user.id,
      tenant.id,
      text(formData, "threadId"),
      text(formData, "sourceMessageId"),
    ),
  );
  revalidatePath("/conversation");
  redirect(
    conversationPlanRedirect(
      result.threadId,
      result.approvalStatus === "draft" ? "clarification" : "cree",
      result.id,
    ),
  );
}

export async function decideConversationPlanAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const result = await safeServerAction("conversation.plan_decide", async () => {
    const decision = z
      .enum(["approved", "rejected"])
      .parse(text(formData, "decision"));
    const plan = await services.decidePlan(
      user.id,
      tenant.id,
      text(formData, "planId"),
      decision,
      text(formData, "reason"),
    );
    return { decision, plan };
  });
  revalidatePath("/conversation");
  redirect(
    conversationPlanRedirect(
      result.plan.threadId,
      result.decision,
      result.plan.id,
    ),
  );
}

export async function reviseConversationPlanAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const result = await safeServerAction("conversation.plan_revise", () =>
    services.revisePlan(
      user.id,
      tenant.id,
      text(formData, "planId"),
      text(formData, "taskTitle"),
    ),
  );
  revalidatePath("/conversation");
  redirect(
    conversationPlanRedirect(result.threadId, "revised", result.id),
  );
}

export async function delegateConversationPlanAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const result = await safeServerAction("conversation.plan_delegate", async () => {
    const expectedDelegationVersion = z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(0).max(31))
      .parse(text(formData, "expectedDelegationVersion"));
    const plan = await services.delegatePlan(user.id, tenant.id, {
      planId: text(formData, "planId"),
      delegatedToUserId: text(formData, "delegatedToUserId"),
      expectedDelegationVersion,
      idempotencyKey: text(formData, "idempotencyKey"),
      confirmed: requiredConfirmation(formData, "delegationConfirmed"),
    });
    return {
      plan,
      delegationId: z.string().min(1).parse(plan.delegation?.id),
    };
  });
  revalidatePath("/conversation");
  redirect(
    conversationPlanRedirect(
      result.plan.threadId,
      "delegated",
      result.plan.id,
      result.delegationId,
    ),
  );
}

export async function executeConversationPlanAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const result = await safeServerAction("conversation.plan_execute", () =>
    services.executePlan(
      user.id,
      tenant.id,
      text(formData, "planId"),
    ),
  );
  revalidatePath("/conversation");
  redirect(
    conversationPlanRedirect(result.threadId, "executed", result.id),
  );
}

export async function retryConversationPlanAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const result = await safeServerAction("conversation.plan_retry", () =>
    services.retryPlan(user.id, tenant.id, text(formData, "planId")),
  );
  revalidatePath("/conversation");
  redirect(`/conversation?fil=${encodeURIComponent(result.threadId)}`);
}

export async function authorizeMetaWhatsAppTrialAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const result = await safeServerAction(
    "conversation.meta_trial_authorize",
    () =>
      services.authorizeMetaWhatsAppTrial(user.id, tenant.id, {
        idempotencyKey: text(formData, "idempotencyKey"),
        freeUnitsConfirmed: requiredConfirmation(
          formData,
          "freeUnitsConfirmed",
        ),
      }),
  );
  revalidatePath("/conversation");
  redirect(
    conversationRedirect(formData, result.revoked ? undefined : "autorise"),
  );
}

export async function revokeMetaWhatsAppTrialAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const result = await safeServerAction("conversation.meta_trial_revoke", () =>
    services.revokeMetaWhatsAppTrial(user.id, tenant.id),
  );
  revalidatePath("/conversation");
  redirect(
    conversationRedirect(
      formData,
      result.revokedCount > 0 ? "revoque" : undefined,
    ),
  );
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(formData: FormData, key: string) {
  return text(formData, key) || undefined;
}

function requiredConfirmation(formData: FormData, key: string): true {
  z.literal("true").parse(text(formData, key));
  return true;
}

function conversationPlanRedirect(
  threadId: string,
  receipt:
    | "clarification"
    | "cree"
    | "revised"
    | "delegated"
    | "approved"
    | "rejected"
    | "executed",
  planId: string,
  delegationId?: string,
) {
  const params = new URLSearchParams({
    fil: threadId,
    plan: receipt,
    plan_id: planId,
  });
  if (delegationId) params.set("delegation_id", delegationId);
  return `/conversation?${params.toString()}`;
}

function conversationRedirect(
  formData: FormData,
  metaTrial?: "autorise" | "revoque",
) {
  const params = new URLSearchParams();
  if (metaTrial) params.set("meta_essai", metaTrial);
  const threadId = optionalText(formData, "threadId");
  if (threadId) params.set("fil", threadId);
  const query = params.toString();
  return query ? `/conversation?${query}` : "/conversation";
}
