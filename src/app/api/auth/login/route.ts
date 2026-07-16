import {
  secureCookieEnabled,
  sessionCookieName,
  tenantCookieName,
} from "@/lib/security";
import { isTrustedFormOrigin, redirectFormPost } from "@/lib/form-post";
import { getServices } from "@/lib/services";

export async function POST(request: Request) {
  if (!isTrustedFormOrigin(request)) {
    return redirectFormPost("/?connexion=erreur");
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
    const response = redirectFormPost(
      context ? "/aujourdhui" : "/creer-organisation",
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
    return response;
  } catch {
    return redirectFormPost("/?connexion=erreur");
  }
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
