import { NextResponse } from "next/server";
import {
  secureCookieEnabled,
  sessionCookieName,
  tenantCookieName,
} from "@/lib/security";
import { getServices } from "@/lib/services";

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin !== requestUrl.origin) {
    return NextResponse.redirect(new URL("/?connexion=erreur", requestUrl), 303);
  }

  try {
    const formData = await request.formData();
    const services = await getServices();
    const user = await services.loginUser({
      email: text(formData, "email"),
      password: text(formData, "password"),
    });
    const session = await services.createSession(user.id);
    const context = await services.getTenantContext(user.id);
    const response = NextResponse.redirect(
      new URL(context ? "/aujourdhui" : "/creer-organisation", requestUrl),
      303,
    );
    response.cookies.set(sessionCookieName, session.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookieEnabled(),
      path: "/",
      expires: new Date(session.expiresAt),
    });
    if (context) {
      response.cookies.set(tenantCookieName, context.tenant.id, {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookieEnabled(),
        path: "/",
      });
    }
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.redirect(new URL("/?connexion=erreur", requestUrl), 303);
  }
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
