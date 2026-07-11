"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  clearSessionCookie,
  getSessionIdFromCookie,
  setTenantCookie,
} from "@/lib/security";
import { getServices } from "@/lib/services";
import {
  getCurrentSession,
  requireTenantContext,
  requireUser,
  signInUser,
} from "@/lib/session";
import type { Role, WebsiteTemplateKey } from "@/lib/types";

export async function registerAction(formData: FormData) {
  const services = await getServices();
  const user = await services.registerUser({
    name: text(formData, "name"),
    email: text(formData, "email"),
    password: text(formData, "password"),
  });
  const context = await signInUser(user.id);
  redirect(context ? "/aujourdhui" : "/creer-organisation");
}

export async function loginAction(formData: FormData) {
  const services = await getServices();
  const user = await services.loginUser({
    email: text(formData, "email"),
    password: text(formData, "password"),
  });
  const context = await signInUser(user.id);
  redirect(context ? "/aujourdhui" : "/creer-organisation");
}

export async function requestPasswordResetAction(formData: FormData) {
  const services = await getServices();
  const email = text(formData, "email").toLowerCase();
  await services.requestPasswordReset({ email });
  redirect(`/mot-de-passe-oublie/confirme?email=${encodeURIComponent(email)}`);
}

export async function resetPasswordAction(formData: FormData) {
  const services = await getServices();
  const password = text(formData, "password");

  if (password !== text(formData, "passwordConfirm")) {
    throw new Error("La confirmation du mot de passe ne correspond pas.");
  }

  await services.resetPassword({
    token: text(formData, "token"),
    password,
  });
  redirect("/?motdepasse=reinitialise");
}

export async function logoutAction() {
  const services = await getServices();
  await services.revokeSession(await getSessionIdFromCookie());
  await clearSessionCookie();
  redirect("/");
}

export async function createOrganizationAction(formData: FormData) {
  const user = await requireUser();
  const services = await getServices();
  const tenant = await services.createTenant(user.id, {
    name: text(formData, "name"),
    category: text(formData, "category"),
  });
  await setTenantCookie(tenant.id);
  redirect("/onboarding");
}

export async function switchTenantAction(formData: FormData) {
  const user = await requireUser();
  const services = await getServices();
  const tenantId = text(formData, "tenantId");
  await services.switchTenant(user.id, tenantId);
  await setTenantCookie(tenantId);
  revalidatePath("/", "layout");
  redirect("/aujourdhui");
}

export async function createInvitationAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const invitation = await services.createInvitation(user.id, tenant.id, {
    email: text(formData, "email"),
    role: text(formData, "role") as Exclude<Role, "owner">,
  });
  const invitationUrl = `/invitation?token=${encodeURIComponent(
    invitation.invitationToken,
  )}`;

  revalidatePath("/parametres");
  redirect(
    `/parametres?invitation=${encodeURIComponent(
      invitationUrl,
    )}&inviteEmail=${encodeURIComponent(invitation.email)}`,
  );
}

export async function acceptInvitationAction(formData: FormData) {
  const services = await getServices();
  const session = await getCurrentSession();
  const token = text(formData, "token");

  if (!session && text(formData, "password") !== text(formData, "passwordConfirm")) {
    throw new Error("La confirmation du mot de passe ne correspond pas.");
  }

  const accepted = session
    ? await services.acceptInvitationForUser(session.user.id, token)
    : await services.acceptInvitation({
        token,
        name: text(formData, "name"),
        password: text(formData, "password"),
      });

  if (!session) {
    await signInUser(accepted.user.id);
  }
  await setTenantCookie(accepted.tenant.id);
  redirect("/aujourdhui");
}

export async function updateMemberRoleAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await services.updateMemberRole(user.id, tenant.id, {
    targetUserId: text(formData, "targetUserId"),
    role: text(formData, "role") as Exclude<Role, "owner">,
  });
  revalidatePath("/parametres");
  redirect("/parametres");
}

export async function saveOnboardingAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await services.saveOnboarding(user.id, tenant.id, {
    companyName: text(formData, "companyName"),
    category: text(formData, "category"),
    description: text(formData, "description"),
    services: text(formData, "services"),
    products: text(formData, "products"),
    targetCustomers: text(formData, "targetCustomers"),
    address: text(formData, "address"),
    serviceAreas: text(formData, "serviceAreas"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    openingHours: text(formData, "openingHours"),
    desiredCallsToAction: text(formData, "desiredCallsToAction"),
    tone: text(formData, "tone"),
    colors: text(formData, "colors"),
    existingWebsite: text(formData, "existingWebsite"),
    socialLinks: text(formData, "socialLinks"),
    photos: text(formData, "photos"),
    mainObjective: text(formData, "mainObjective"),
    faqs: text(formData, "faqs"),
    templateKey: text(formData, "templateKey") as WebsiteTemplateKey,
  });
  revalidatePath("/", "layout");
  redirect("/mon-site");
}

export async function updateSectionAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await services.updateWebsiteSection(user.id, tenant.id, text(formData, "sectionId"), {
    title: text(formData, "title"),
    body: text(formData, "body"),
    imageUrl: text(formData, "imageUrl"),
    buttonLabel: text(formData, "buttonLabel"),
    buttonHref: text(formData, "buttonHref"),
    enabled: formData.get("enabled") === "on",
  });
  revalidatePath("/mon-site");
}

export async function moveSectionAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await services.moveWebsiteSection(
    user.id,
    tenant.id,
    text(formData, "sectionId"),
    text(formData, "direction") === "up" ? "up" : "down",
  );
  revalidatePath("/mon-site");
}

export async function publishWebsiteAction() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const url = await services.publishWebsite(user.id, tenant.id);
  revalidatePath("/mon-site");
  revalidatePath(url);
}

export async function restoreVersionAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await services.restoreWebsiteVersion(user.id, tenant.id, text(formData, "versionId"));
  revalidatePath("/mon-site");
}

export async function submitSiteLeadAction(slug: string, formData: FormData) {
  if (formData.get("preview") === "1") {
    return;
  }

  if (text(formData, "website")) {
    throw new Error("La demande n'a pas pu être acceptée.");
  }

  if (formData.get("privacyConsent") !== "on") {
    throw new Error("Le consentement est requis pour envoyer la demande.");
  }

  const services = await getServices();
  await services.submitPublicLead(slug, {
    name: text(formData, "name"),
    email: text(formData, "email"),
    phone: text(formData, "phone"),
    message: text(formData, "message"),
    idempotencyKey: text(formData, "idempotencyKey"),
  });
  revalidatePath(`/sites/${slug}`);
  redirect(`/sites/${slug}/merci`);
}

export async function importCsvAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await services.importCsvContacts(user.id, tenant.id, text(formData, "csvText"));
  revalidatePath("/connexions");
  revalidatePath("/contacts");
}

export async function syncMockConnectorAction() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await services.syncMockConnector(user.id, tenant.id);
  revalidatePath("/connexions");
  revalidatePath("/aujourdhui");
}

export async function seedDemoAction() {
  const demoEnabled =
    process.env.NODE_ENV !== "production" ||
    process.env.FEATURE_PUBLIC_DEMO === "true";

  if (!demoEnabled) {
    throw new Error("La démonstration publique est désactivée.");
  }

  const services = await getServices();
  const demo = await services.seedDemo();
  const context = await signInUser(demo.user.id);
  if (context) {
    await setTenantCookie(demo.tenant.id);
  }
  redirect("/aujourdhui");
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
