"use server";

import { redirect } from "next/navigation";
import { getServices } from "@/lib/services";
import { safeServerAction } from "@/lib/public-action";
import { requireTenantContext } from "@/lib/session";

export async function authorizeMockOAuthCallbackAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const result = await safeServerAction("oauth.authorization_grant", () =>
    services.authorizeMockOAuthRequest(user.id, tenant.id, {
      state: text(formData, "state"),
      codeChallenge: text(formData, "codeChallenge"),
      redirectUri: text(formData, "redirectUri"),
    }),
  );

  const callbackUrl = new URL(result.callbackUrl);
  callbackUrl.searchParams.set("tenant_id", tenant.id);
  callbackUrl.searchParams.set("actor_id", user.id);
  redirect(callbackUrl.toString());
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
