import "server-only";
import { redirect } from "next/navigation";
import { getServices } from "@/lib/services";
import {
  getSessionIdFromCookie,
  getTenantIdFromCookie,
  setSessionCookie,
  setTenantCookie,
} from "@/lib/security";

export async function getCurrentSession() {
  const services = await getServices();
  const sessionId = await getSessionIdFromCookie();
  return services.getSessionUser(sessionId);
}

export async function requireUser() {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/");
  }

  return session.user;
}

export async function requireTenantContext() {
  const user = await requireUser();
  const services = await getServices();
  const preferredTenantId = await getTenantIdFromCookie();
  const context = await services.getTenantContext(user.id, preferredTenantId);

  if (!context) {
    redirect("/creer-organisation");
  }

  return { user, ...context };
}

export async function signInUser(userId: string) {
  const services = await getServices();
  const session = await services.createSession(userId);
  await setSessionCookie(session.sessionToken, session.expiresAt);
  const context = await services.getTenantContext(userId);
  if (context) {
    await setTenantCookie(context.tenant.id);
  }

  return context;
}
