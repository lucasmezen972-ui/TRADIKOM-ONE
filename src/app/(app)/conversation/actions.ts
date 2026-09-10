"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeServerAction } from "@/lib/public-action";
import { requireTenantContext } from "@/lib/session";
import { getConversationChannelServices } from "@/modules/channels";

export async function sendWebConversationMessageAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const result = await safeServerAction("conversation.web_ingest", () =>
    services.web.ingest(user.id, {
      tenantId: tenant.id,
      threadId: optionalText(formData, "threadId"),
      displayName: user.name,
      externalMessageId: text(formData, "externalMessageId"),
      idempotencyKey: text(formData, "idempotencyKey"),
      correlationId: text(formData, "correlationId"),
      text: text(formData, "message"),
      occurredAt: text(formData, "occurredAt"),
    }),
  );
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
    `/conversation?fil=${encodeURIComponent(result.threadId)}&plan=cree`,
  );
}

export async function decideConversationPlanAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const threadId = text(formData, "threadId");
  const decision =
    text(formData, "decision") === "approved" ? "approved" : "rejected";
  await safeServerAction("conversation.plan_decide", () =>
    services.decidePlan(
      user.id,
      tenant.id,
      text(formData, "planId"),
      decision,
      text(formData, "reason"),
    ),
  );
  revalidatePath("/conversation");
  redirect(
    `/conversation?fil=${encodeURIComponent(threadId)}&plan=${decision}`,
  );
}

export async function executeConversationPlanAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const threadId = text(formData, "threadId");
  await safeServerAction("conversation.plan_execute", () =>
    services.executePlan(
      user.id,
      tenant.id,
      text(formData, "planId"),
    ),
  );
  revalidatePath("/conversation");
  redirect(
    `/conversation?fil=${encodeURIComponent(threadId)}&plan=executed`,
  );
}

export async function retryConversationPlanAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const threadId = text(formData, "threadId");
  await safeServerAction("conversation.plan_retry", () =>
    services.retryPlan(user.id, tenant.id, text(formData, "planId")),
  );
  revalidatePath("/conversation");
  redirect(
    `/conversation?fil=${encodeURIComponent(threadId)}&reprise=demandee`,
  );
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
