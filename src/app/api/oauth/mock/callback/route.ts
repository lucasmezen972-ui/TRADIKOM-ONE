import { NextResponse } from "next/server";
import { setSessionCookie, setTenantCookie } from "@/lib/security";
import { getServices } from "@/lib/services";
import { resolveAppUrl } from "@/modules/email";
import { OAuthError } from "@/modules/oauth/errors";
import { resolveCorrelationId } from "@/modules/request-context";

export async function GET(request: Request) {
  const appOrigin = resolveAppUrl();
  const redirectUri = new URL("/api/oauth/mock/callback", appOrigin).toString();
  const requestUrl = new URL(request.url);
  const correlationId = resolveCorrelationId(
    request.headers.get("x-correlation-id"),
  );

  try {
    const tenantId = callbackContext(
      requestUrl.searchParams.get("tenant_id"),
      "tenant_",
    );
    const actorId = callbackContext(
      requestUrl.searchParams.get("actor_id"),
      "user_",
    );
    const services = await getServices();
    await services.completeMockOAuthConnection(actorId, tenantId, {
      state: requestUrl.searchParams.get("state") ?? "",
      code: requestUrl.searchParams.get("code") ?? "",
      redirectUri,
    });

    // The authorization response is a top-level redirect. Re-issue the
    // application session only after the one-time state, code and PKCE checks
    // succeeded so the protected return page remains authenticated even when
    // the browser omits the original cookie on the callback request.
    const session = await services.createSession(actorId);
    await setSessionCookie(session.sessionToken, session.expiresAt);
    await setTenantCookie(tenantId);

    return redirectWithContext(
      "/connexions/logiciels?oauth=connecte",
      appOrigin,
      correlationId,
    );
  } catch (error) {
    const errorCode =
      error instanceof OAuthError ? error.code : "oauth_callback_failed";
    return redirectWithContext(
      `/connexions/logiciels?oauth=erreur&code=${encodeURIComponent(errorCode)}`,
      appOrigin,
      correlationId,
    );
  }
}

function callbackContext(value: string | null, prefix: "tenant_" | "user_") {
  if (
    !value ||
    value.length > 96 ||
    !value.startsWith(prefix) ||
    !/^[a-z0-9_]+$/.test(value)
  ) {
    throw new OAuthError(
      "oauth_state_invalid",
      "Le contexte de retour OAuth est invalide.",
    );
  }
  return value;
}

function redirectWithContext(path: string, appOrigin: string, correlationId: string) {
  const response = NextResponse.redirect(new URL(path, appOrigin));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("x-correlation-id", correlationId);
  return response;
}
