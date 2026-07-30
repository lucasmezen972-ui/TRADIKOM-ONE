"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(formData: FormData, key: string) {
  return text(formData, key) || undefined;
}
