import { NextResponse } from "next/server";
import {
  secureCookieEnabled,
  sessionCookieName,
  tenantCookieName,
} from "@/lib/security";
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
    // succeeded. The cookies must be attached to this exact redirect response;
    // mutating the ambient cookie store can lose them when returning a custom
    // NextResponse from a route handler.
    const session = await services.createSession(actorId);
    const response = redirectWithContext(
      "/connexions/logiciels?oauth=connecte",
      appOrigin,
      correlationId,
    );
    response.cookies.set(sessionCookieName, session.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookieEnabled(),
      path: "/",
      expires: new Date(session.expiresAt),
    });
    response.cookies.set(tenantCookieName, tenantId, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookieEnabled(),
      path: "/",
    });
    return response;
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
