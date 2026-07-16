"use server";

import { redirect } from "next/navigation";
import { getServices } from "@/lib/services";
import { safeServerAction } from "@/lib/public-action";
import { requireTenantContext } from "@/lib/session";

export async function authorizeMockOAuthCallbackAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const granted = await safeServerAction("oauth.authorization_grant", () =>
    services.authorizeMockOAuthRequest(user.id, tenant.id, {
      state: text(formData, "state"),
      codeChallenge: text(formData, "codeChallenge"),
      redirectUri: text(formData, "redirectUri"),
    }),
  );

  const callbackUrl = new URL(granted.callbackUrl);
  await safeServerAction("oauth.connection_complete", () =>
    services.completeMockOAuthConnection(user.id, tenant.id, {
      state: callbackUrl.searchParams.get("state") ?? "",
      code: callbackUrl.searchParams.get("code") ?? "",
      redirectUri: `${callbackUrl.origin}${callbackUrl.pathname}`,
    }),
  );

  redirect("/connexions/logiciels?oauth=connecte");
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
