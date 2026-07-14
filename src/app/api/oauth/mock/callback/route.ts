import { NextResponse } from "next/server";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import { resolveAppUrl } from "@/modules/email";
import { resolveCorrelationId } from "@/modules/request-context";

export async function GET(request: Request) {
  const { user, tenant } = await requireTenantContext();
  const appOrigin = resolveAppUrl();
  const redirectUri = new URL("/api/oauth/mock/callback", appOrigin).toString();
  const requestUrl = new URL(request.url);
  const state = requestUrl.searchParams.get("state") ?? "";
  const code = requestUrl.searchParams.get("code") ?? "";
  const correlationId = resolveCorrelationId(
    request.headers.get("x-correlation-id"),
  );

  try {
    const services = await getServices();
    await services.completeMockOAuthConnection(user.id, tenant.id, {
      state,
      code,
      redirectUri,
    });
    return redirectWithContext(
      "/connexions/logiciels?oauth=connecte",
      appOrigin,
      correlationId,
    );
  } catch {
    return redirectWithContext(
      "/connexions/logiciels?oauth=erreur",
      appOrigin,
      correlationId,
    );
  }
}

function redirectWithContext(path: string, appOrigin: string, correlationId: string) {
  const response = NextResponse.redirect(new URL(path, appOrigin));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("x-correlation-id", correlationId);
  return response;
}
