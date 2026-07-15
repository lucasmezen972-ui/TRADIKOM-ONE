"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  clearSessionCookie,
  getSessionIdFromCookie,
  id,
  setTenantCookie,
} from "@/lib/security";
import { getServices } from "@/lib/services";
import { safeServerAction } from "@/lib/public-action";
import {
  getCurrentSession,
  requireTenantContext,
  requireUser,
  signInUser,
} from "@/lib/session";
import type { Role, WebsiteTemplateKey } from "@/lib/types";
import { isPublicDemoEnabled } from "@/modules/demo";
import { canonicalEntitySchema } from "@/modules/api-intelligence";
import { sourceTypeSchema } from "@/modules/software-directory";
import type {
  BusinessBrainDomain,
  BusinessBrainEvidenceType,
} from "@/modules/business-brain";
import { reputationSourceSchema } from "@/modules/reputation-ai";
import {
  competitorCategorySchema,
  competitorDirectionSchema,
  competitorSourceTypeSchema,
} from "@/modules/competitor-intelligence";

export async function registerAction(formData: FormData) {
  const services = await getServices();
  const user = await safeServerAction("auth.register", () =>
    services.registerUser({
      name: text(formData, "name"),
      email: text(formData, "email"),
      password: text(formData, "password"),
    }),
  );
  const context = await signInUser(user.id);
  redirect(context ? "/aujourdhui" : "/creer-organisation");
}

export async function loginAction(formData: FormData) {
  const services = await getServices();
  const user = await safeServerAction("auth.login", () =>
    services.loginUser({
      email: text(formData, "email"),
      password: text(formData, "password"),
    }),
  );
  const context = await signInUser(user.id);
  redirect(context ? "/aujourdhui" : "/creer-organisation");
}

export async function requestPasswordResetAction(formData: FormData) {
  const services = await getServices();
  const email = text(formData, "email").toLowerCase();
  const result = await safeServerAction("auth.password_reset_request", () =>
    services.requestPasswordReset({ email }),
  );
  const developmentLink =
    "developmentLink" in result ? result.developmentLink : undefined;
  const preview = developmentLink
    ? `&lien=${encodeURIComponent(developmentLink)}`
    : "";
  redirect(
    `/mot-de-passe-oublie/confirme?email=${encodeURIComponent(email)}${preview}`,
  );
}

export async function resetPasswordAction(formData: FormData) {
  const services = await getServices();
  const password = text(formData, "password");

  if (password !== text(formData, "passwordConfirm")) {
    throw new Error("La confirmation du mot de passe ne correspond pas.");
  }

  await safeServerAction("auth.password_reset", () =>
    services.resetPassword({
      token: text(formData, "token"),
      password,
    }),
  );
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
  const invitation = await safeServerAction("invitation.create", () =>
    services.createInvitation(user.id, tenant.id, {
      email: text(formData, "email"),
      role: text(formData, "role") as Exclude<Role, "owner">,
    }),
  );
  revalidatePath("/parametres");
  const preview = invitation.developmentLink
    ? `&lien=${encodeURIComponent(invitation.developmentLink)}`
    : "";
  redirect(
    `/parametres?invitationEnvoyee=1&inviteEmail=${encodeURIComponent(
      invitation.email,
    )}${preview}`,
  );
}

export async function resendInvitationAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const invitation = await safeServerAction("invitation.resend", () =>
    services.resendInvitation(
      user.id,
      tenant.id,
      text(formData, "invitationId"),
    ),
  );

  revalidatePath("/parametres");
  const preview = invitation.developmentLink
    ? `&lien=${encodeURIComponent(invitation.developmentLink)}`
    : "";
  redirect(
    `/parametres?invitationEnvoyee=1&inviteEmail=${encodeURIComponent(
      invitation.email,
    )}${preview}`,
  );
}

export async function acceptInvitationAction(formData: FormData) {
  const services = await getServices();
  const session = await getCurrentSession();
  const token = text(formData, "token");

  if (!session && text(formData, "password") !== text(formData, "passwordConfirm")) {
    throw new Error("La confirmation du mot de passe ne correspond pas.");
  }

  const accepted = await safeServerAction("invitation.accept", () =>
    session
      ? services.acceptInvitationForUser(session.user.id, token)
      : services.acceptInvitation({
          token,
          name: text(formData, "name"),
          password: text(formData, "password"),
        }),
  );

  if (!session) {
    await signInUser(accepted.user.id);
  }
  await setTenantCookie(accepted.tenant.id);
  redirect("/aujourdhui");
}

export async function updateMemberRoleAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("invitation.member_role_update", () =>
    services.updateMemberRole(user.id, tenant.id, {
      targetUserId: text(formData, "targetUserId"),
      role: text(formData, "role") as Exclude<Role, "owner">,
    }),
  );
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

export async function createBusinessBrainEntryAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("business_brain.entry_create", () =>
    services.createBusinessBrainEntry(user.id, tenant.id, {
      domain: text(formData, "domain") as BusinessBrainDomain,
      title: text(formData, "title"),
      summary: text(formData, "summary"),
      details: text(formData, "details"),
      confidence: text(formData, "confidence"),
      sourceType: "manual",
      sourceRef: text(formData, "sourceRef") || undefined,
      evidenceType: text(
        formData,
        "evidenceType",
      ) as BusinessBrainEvidenceType,
      evidenceSummary: text(formData, "evidenceSummary"),
    }),
  );
  revalidatePath("/cerveau-entreprise");
  redirect("/cerveau-entreprise?ajout=1");
}

export async function reviseBusinessBrainEntryAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("business_brain.entry_revise", () =>
    services.reviseBusinessBrainEntry(user.id, tenant.id, {
      entryId: text(formData, "entryId"),
      domain: text(formData, "domain") as BusinessBrainDomain,
      title: text(formData, "title"),
      summary: text(formData, "summary"),
      details: text(formData, "details"),
      confidence: text(formData, "confidence"),
      sourceType: "manual",
      sourceRef: text(formData, "sourceRef") || undefined,
      evidenceType: text(
        formData,
        "evidenceType",
      ) as BusinessBrainEvidenceType,
      evidenceSummary: text(formData, "evidenceSummary"),
    }),
  );
  revalidatePath("/cerveau-entreprise");
  redirect("/cerveau-entreprise?revision=1");
}

export async function archiveBusinessBrainEntryAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("business_brain.entry_archive", () =>
    services.archiveBusinessBrainEntry(user.id, tenant.id, {
      entryId: text(formData, "entryId"),
    }),
  );
  revalidatePath("/cerveau-entreprise");
  redirect("/cerveau-entreprise?archive=1");
}

export async function generateStrategicRecommendationsAction() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const result = await safeServerAction("strategic_advisor.generate", () =>
    services.generateStrategicRecommendations(user.id, tenant.id),
  );
  revalidatePath("/conseiller-strategique");
  revalidatePath("/aujourdhui");
  redirect(
    `/conseiller-strategique?analyse=1&nouvelles=${result.createdIds.length}`,
  );
}

export async function decideStrategicRecommendationAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const decision = text(formData, "decision") === "approved"
    ? "approved"
    : "rejected";
  await safeServerAction("strategic_advisor.decide", () =>
    services.decideStrategicRecommendation(user.id, tenant.id, {
      recommendationId: text(formData, "recommendationId"),
      decision,
      reason: text(formData, "reason"),
    }),
  );
  revalidatePath("/conseiller-strategique");
  revalidatePath("/aujourdhui");
  redirect(`/conseiller-strategique?decision=${decision}`);
}

export async function generateMarketingProposalsAction() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const result = await safeServerAction("autonomous_marketing.generate", () =>
    services.generateMarketingCampaignProposals(user.id, tenant.id),
  );
  revalidatePath("/marketing");
  redirect(`/marketing?generation=1&nouvelles=${result.createdIds.length}`);
}

export async function submitMarketingProposalAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("autonomous_marketing.submit", () =>
    services.submitMarketingProposalForApproval(user.id, tenant.id, {
      proposalId: text(formData, "proposalId"),
    }),
  );
  revalidatePath("/marketing");
  revalidatePath("/aujourdhui");
  redirect("/marketing?soumission=1");
}

export async function decideMarketingProposalAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const decision = text(formData, "decision") === "approved"
    ? "approved"
    : "rejected";
  await safeServerAction("autonomous_marketing.decide", () =>
    services.decideMarketingProposal(user.id, tenant.id, {
      proposalId: text(formData, "proposalId"),
      decision,
      reason: text(formData, "reason"),
    }),
  );
  revalidatePath("/marketing");
  revalidatePath("/aujourdhui");
  redirect(`/marketing?decision=${decision}`);
}

export async function reviseMarketingProposalAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("autonomous_marketing.revise", () =>
    services.reviseMarketingProposal(user.id, tenant.id, {
      proposalId: text(formData, "proposalId"),
      title: text(formData, "title"),
      subject: text(formData, "subject"),
      objective: text(formData, "objective"),
      audience: text(formData, "audience"),
      content: text(formData, "content"),
      callToAction: text(formData, "callToAction"),
      expectedOutcome: text(formData, "expectedOutcome"),
      riskSummary: text(formData, "riskSummary"),
      budgetCents: null,
      startsAt: null,
      endsAt: null,
    }),
  );
  revalidatePath("/marketing");
  redirect("/marketing?revision=1");
}

export async function generateWebsiteAiProposalsAction() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const result = await safeServerAction("website_ai.generate", () =>
    services.generateWebsiteAiProposals(user.id, tenant.id),
  );
  revalidatePath("/mon-site");
  redirect(`/mon-site?analyse=1&nouvelles=${result.createdIds.length}`);
}

export async function submitWebsiteAiProposalAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("website_ai.submit", () =>
    services.submitWebsiteAiProposalForApproval(user.id, tenant.id, {
      proposalId: text(formData, "proposalId"),
    }),
  );
  revalidatePath("/mon-site");
  revalidatePath("/aujourdhui");
  redirect("/mon-site?iaSoumise=1");
}

export async function decideWebsiteAiProposalAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const decision = text(formData, "decision") === "approved"
    ? "approved"
    : "rejected";
  await safeServerAction("website_ai.decide", () =>
    services.decideWebsiteAiProposal(user.id, tenant.id, {
      proposalId: text(formData, "proposalId"),
      decision,
      reason: text(formData, "reason"),
    }),
  );
  revalidatePath("/mon-site");
  revalidatePath("/aujourdhui");
  redirect(`/mon-site?iaDecision=${decision}`);
}

export async function applyWebsiteAiProposalAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const result = await safeServerAction("website_ai.apply", () =>
    services.applyApprovedWebsiteAiProposal(user.id, tenant.id, {
      proposalId: text(formData, "proposalId"),
    }),
  );
  revalidatePath("/mon-site");
  redirect(`/mon-site?iaApplication=${result.stale ? "stale" : "applied"}`);
}

export async function generateSalesAiAssessmentsAction() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const result = await safeServerAction("sales_ai.generate", () =>
    services.generateSalesAiAssessments(user.id, tenant.id),
  );
  revalidatePath("/assistant-commercial");
  redirect(
    `/assistant-commercial?analyse=1&nouvelles=${result.createdIds.length}`,
  );
}

export async function createReputationReviewAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const rating = text(formData, "rating");
  await safeServerAction("reputation.review_import", () =>
    services.createReputationReview(user.id, tenant.id, {
      source: reputationSourceSchema.parse(text(formData, "source")),
      externalRef: text(formData, "externalRef") || undefined,
      reviewerAlias: text(formData, "reviewerAlias") || undefined,
      rating: rating ? Number(rating) : null,
      reviewText: text(formData, "reviewText"),
      occurredAt: text(formData, "occurredAt"),
    }),
  );
  revalidatePath("/reputation");
  redirect("/reputation?avisImporte=1");
}

export async function generateReputationProposalsAction() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const result = await safeServerAction("reputation.generate", () =>
    services.generateReputationProposals(user.id, tenant.id),
  );
  revalidatePath("/reputation");
  redirect(`/reputation?analyse=1&nouvelles=${result.createdIds.length}`);
}

export async function submitReputationProposalAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("reputation.submit", () =>
    services.submitReputationProposalForApproval(user.id, tenant.id, {
      proposalId: text(formData, "proposalId"),
    }),
  );
  revalidatePath("/reputation");
  revalidatePath("/aujourdhui");
  redirect("/reputation?soumise=1");
}

export async function decideReputationProposalAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const decision = text(formData, "decision") === "approved"
    ? "approved"
    : "rejected";
  await safeServerAction("reputation.decide", () =>
    services.decideReputationProposal(user.id, tenant.id, {
      proposalId: text(formData, "proposalId"),
      decision,
      reason: text(formData, "reason"),
    }),
  );
  revalidatePath("/reputation");
  revalidatePath("/aujourdhui");
  redirect(`/reputation?decision=${decision}`);
}

export async function createCompetitorProfileAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("competitor.profile_create", () =>
    services.createCompetitorProfile(user.id, tenant.id, {
      name: text(formData, "name"),
      websiteUrl: text(formData, "websiteUrl") || undefined,
    }),
  );
  revalidatePath("/veille-concurrentielle");
  redirect("/veille-concurrentielle?concurrentCree=1");
}

export async function createCompetitorObservationAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("competitor.observation_create", () =>
    services.createCompetitorObservation(user.id, tenant.id, {
      competitorId: text(formData, "competitorId"),
      category: competitorCategorySchema.parse(text(formData, "category")),
      direction: competitorDirectionSchema.parse(text(formData, "direction")),
      sourceType: competitorSourceTypeSchema.parse(text(formData, "sourceType")),
      sourceUrl: text(formData, "sourceUrl"),
      title: text(formData, "title"),
      summary: text(formData, "summary"),
      observedValue: text(formData, "observedValue") || undefined,
      observedAt: text(formData, "observedAt"),
      publicSourceConfirmed: formData.get("publicSourceConfirmed") === "on",
      protectedContentExcluded: formData.get("protectedContentExcluded") === "on",
    }),
  );
  revalidatePath("/veille-concurrentielle");
  redirect("/veille-concurrentielle?observationCreee=1");
}

export async function generateCompetitorInsightsAction() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const result = await safeServerAction("competitor.generate", () =>
    services.generateCompetitorInsights(user.id, tenant.id),
  );
  revalidatePath("/veille-concurrentielle");
  redirect(
    `/veille-concurrentielle?analyse=1&nouvelles=${result.createdIds.length}`,
  );
}

export async function submitCompetitorInsightAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("competitor.submit", () =>
    services.submitCompetitorInsightForApproval(user.id, tenant.id, {
      insightId: text(formData, "insightId"),
    }),
  );
  revalidatePath("/veille-concurrentielle");
  revalidatePath("/aujourdhui");
  redirect("/veille-concurrentielle?soumise=1");
}

export async function decideCompetitorInsightAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const decision = text(formData, "decision") === "approved"
    ? "approved"
    : "rejected";
  await safeServerAction("competitor.decide", () =>
    services.decideCompetitorInsight(user.id, tenant.id, {
      insightId: text(formData, "insightId"),
      decision,
      reason: text(formData, "reason"),
    }),
  );
  revalidatePath("/veille-concurrentielle");
  revalidatePath("/aujourdhui");
  redirect(`/veille-concurrentielle?decision=${decision}`);
}

export async function recordFinancialInputSnapshotAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("financial_ai.input_record", () =>
    services.recordFinancialInputSnapshot(user.id, tenant.id, {
      period: text(formData, "period"),
      monthlyRevenueCents: strictMoneyToCents(text(formData, "monthlyRevenue")),
      operatingCostsCents: strictMoneyToCents(text(formData, "operatingCosts")),
      cashBalanceCents: strictMoneyToCents(text(formData, "cashBalance")),
      cashInflowsCents: strictMoneyToCents(text(formData, "cashInflows")),
      cashOutflowsCents: strictMoneyToCents(text(formData, "cashOutflows")),
      receivablesCents: strictMoneyToCents(text(formData, "receivables")),
      payablesCents: strictMoneyToCents(text(formData, "payables")),
      marketingSpendCents: strictMoneyToCents(text(formData, "marketingSpend")),
      salesSpendCents: strictMoneyToCents(text(formData, "salesSpend")),
      websiteSpendCents: strictMoneyToCents(text(formData, "websiteSpend")),
      automationSpendCents: strictMoneyToCents(text(formData, "automationSpend")),
      newCustomers: integerValue(formData, "newCustomers"),
      activeCustomers: integerValue(formData, "activeCustomers"),
      averageLifetimeMonths: optionalIntegerValue(
        formData,
        "averageLifetimeMonths",
      ),
      marketingAttributedRevenueCents: optionalMoneyToCents(
        text(formData, "marketingAttributedRevenue"),
      ),
      salesAttributedRevenueCents: optionalMoneyToCents(
        text(formData, "salesAttributedRevenue"),
      ),
      websiteAttributedRevenueCents: optionalMoneyToCents(
        text(formData, "websiteAttributedRevenue"),
      ),
      automationSavingsCents: optionalMoneyToCents(
        text(formData, "automationSavings"),
      ),
      evidenceSummary: text(formData, "evidenceSummary"),
    }),
  );
  revalidatePath("/pilotage-financier");
  redirect("/pilotage-financier?donnees=1");
}

export async function generateFinancialAssessmentAction() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const result = await safeServerAction("financial_ai.generate", () =>
    services.generateFinancialAssessment(user.id, tenant.id),
  );
  revalidatePath("/pilotage-financier");
  redirect(`/pilotage-financier?analyse=1&nouvelle=${result.created ? "1" : "0"}`);
}

export async function initializeAiEmployeeTeamAction() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const result = await safeServerAction("ai_employee.initialize", () =>
    services.initializeAiEmployeeTeam(user.id, tenant.id),
  );
  revalidatePath("/equipe-ia");
  redirect(`/equipe-ia?initialisee=1&nouveaux=${result.createdIds.length}`);
}

export async function reviseAiEmployeeProfileAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const workingDays = formData
    .getAll("workingDays")
    .filter((value): value is string => typeof value === "string")
    .map((value) => Number.parseInt(value, 10));
  await safeServerAction("ai_employee.revise", () =>
    services.reviseAiEmployeeProfile(user.id, tenant.id, {
      employeeId: text(formData, "employeeId"),
      displayName: text(formData, "displayName"),
      purpose: text(formData, "purpose"),
      status: text(formData, "status") === "paused" ? "paused" : "enabled",
      workingDays,
      workdayStart: text(formData, "workdayStart"),
      workdayEnd: text(formData, "workdayEnd"),
    }),
  );
  revalidatePath("/equipe-ia");
  redirect("/equipe-ia?profil=1");
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
  await safeServerAction("public_form.submit", () =>
    services.submitPublicLead(slug, {
      name: text(formData, "name"),
      email: text(formData, "email"),
      phone: text(formData, "phone"),
      message: text(formData, "message"),
      idempotencyKey: text(formData, "idempotencyKey"),
    }),
  );
  revalidatePath(`/sites/${slug}`);
  redirect(`/sites/${slug}/merci`);
}

export async function updateContactAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const contactId = text(formData, "contactId");
  const assignedUserId = text(formData, "assignedUserId");

  await services.updateContact(user.id, tenant.id, contactId, {
    name: text(formData, "name"),
    phone: text(formData, "phone"),
    status: text(formData, "status"),
    tags: list(formData, "tags"),
    assignedUserId: assignedUserId || null,
  });
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
}

export async function updateContactConsentAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const contactId = text(formData, "contactId");

  await services.updateContactConsent(user.id, tenant.id, contactId, {
    marketingOptIn: formData.get("marketingOptIn") === "on",
    privacyNoticeAccepted: formData.get("privacyNoticeAccepted") === "on",
    dataRetentionUntil: text(formData, "dataRetentionUntil") || undefined,
  });
  revalidatePath(`/contacts/${contactId}`);
}

export async function addContactNoteAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const contactId = text(formData, "contactId");

  await services.addContactNote(user.id, tenant.id, contactId, {
    body: text(formData, "body"),
  });
  revalidatePath(`/contacts/${contactId}`);
}

export async function createContactTaskAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const contactId = text(formData, "contactId");
  const assignedUserId = text(formData, "assignedUserId");

  await services.createContactTask(user.id, tenant.id, contactId, {
    title: text(formData, "title"),
    dueAt: text(formData, "dueAt"),
    assignedUserId: assignedUserId || undefined,
  });
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
}

export async function completeContactTaskAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const contactId = text(formData, "contactId");

  await services.completeContactTask(
    user.id,
    tenant.id,
    contactId,
    text(formData, "taskId"),
  );
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
}

export async function mergeContactsAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const leftContactId = text(formData, "leftContactId");
  const rightContactId = text(formData, "rightContactId");
  const survivorContactId = text(formData, "survivorContactId");
  const mergedContactId =
    survivorContactId === leftContactId ? rightContactId : leftContactId;

  if (![leftContactId, rightContactId].includes(survivorContactId)) {
    throw new Error("Le contact survivant est invalide.");
  }

  const mergeRecord = await services.mergeContacts(user.id, tenant.id, {
    survivorContactId,
    mergedContactId,
    reason: text(formData, "reason"),
    confirm: formData.get("confirmMerge") === "on",
    fieldSources: {
      name: mergeFieldSource(formData, "nameSource", survivorContactId),
      email: mergeFieldSource(formData, "emailSource", survivorContactId),
      phone: mergeFieldSource(formData, "phoneSource", survivorContactId),
      status: mergeFieldSource(formData, "statusSource", survivorContactId),
      source: mergeFieldSource(formData, "sourceSource", survivorContactId),
      assignedUserId: mergeFieldSource(
        formData,
        "assignedUserIdSource",
        survivorContactId,
      ),
    },
  });

  revalidatePath("/contacts");
  revalidatePath("/contacts/doublons");
  revalidatePath(`/contacts/${survivorContactId}`);
  redirect(`/contacts/${mergeRecord.survivorContactId}`);
}

export async function updateOpportunityAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const opportunityId = text(formData, "opportunityId");
  const opportunity = await services.updateOpportunity(
    user.id,
    tenant.id,
    opportunityId,
    {
      stageId: text(formData, "stageId"),
      valueCents: moneyToCents(text(formData, "valueEuros")),
      nextFollowUpAt: text(formData, "nextFollowUpAt") || undefined,
      lostReason: text(formData, "lostReason") || undefined,
    },
  );

  revalidatePath("/opportunites");
  revalidatePath(`/opportunites/${opportunityId}`);
  revalidatePath(`/contacts/${opportunity.contactId}`);
}

export async function dismissOpportunityRadarAlertAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();

  await services.dismissOpportunityRadarAlert(
    user.id,
    tenant.id,
    text(formData, "alertId"),
  );
  revalidatePath("/aujourdhui");
  revalidatePath("/opportunites");
  revalidatePath("/opportunites/radar");
}

export async function cancelWorkflowRunAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("workflow.cancel", () =>
    services.cancelWorkflowRun(user.id, tenant.id, text(formData, "runId")),
  );
  revalidatePath("/automatisations");
  revalidatePath("/aujourdhui");
}

export async function approveWorkflowRunAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("workflow.approve", () =>
    services.approveWorkflowRun(user.id, tenant.id, text(formData, "runId")),
  );
  revalidatePath("/automatisations");
  revalidatePath("/aujourdhui");
}

export async function rejectWorkflowRunAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("workflow.reject", () =>
    services.rejectWorkflowRun(user.id, tenant.id, text(formData, "runId")),
  );
  revalidatePath("/automatisations");
  revalidatePath("/aujourdhui");
}

export async function retryWorkflowRunAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("workflow.retry", () =>
    services.requestManualWorkflowRetry(
      user.id,
      tenant.id,
      text(formData, "runId"),
    ),
  );
  revalidatePath("/automatisations");
  revalidatePath("/aujourdhui");
}

export async function retryWorkflowDeadLetterAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("workflow.dead_letter_retry", () =>
    services.retryWorkflowDeadLetter(
      user.id,
      tenant.id,
      text(formData, "eventId"),
    ),
  );
  revalidatePath("/automatisations");
  revalidatePath("/aujourdhui");
}

export async function cancelWorkflowQueueEventAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("workflow.queue_cancel", () =>
    services.cancelWorkflowQueueEvent(
      user.id,
      tenant.id,
      text(formData, "eventId"),
    ),
  );
  revalidatePath("/automatisations");
  revalidatePath("/aujourdhui");
}

export async function importCsvAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("connector.csv_import", () =>
    services.importCsvContacts(user.id, tenant.id, text(formData, "csvText")),
  );
  revalidatePath("/connexions");
  revalidatePath("/contacts");
}

export async function analyzeDomainConnectionAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("domain_connection.analyze", () =>
    services.analyzeDomainConnection(user.id, tenant.id, {
      domain: text(formData, "domain"),
      providerKey: text(formData, "providerKey") as "mock_dns" | "manual",
    }),
  );
  revalidatePath("/connexions/domaines");
  revalidatePath("/connexions");
}

export async function prepareDnsChangePlanAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("domain_connection.dns_plan_prepare", () =>
    services.prepareDnsChangePlan(user.id, tenant.id, {
      connectionId: text(formData, "connectionId"),
    }),
  );
  revalidatePath("/connexions/domaines");
}

export async function approveDnsChangePlanAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("domain_connection.dns_plan_approve", () =>
    services.approveDnsChangePlan(user.id, tenant.id, text(formData, "planId")),
  );
  revalidatePath("/connexions/domaines");
}

export async function confirmDnsChangePlanAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("domain_connection.dns_plan_confirm", () =>
    services.confirmDnsChangePlan(user.id, tenant.id, text(formData, "planId")),
  );
  revalidatePath("/connexions/domaines");
}

export async function simulateDnsChangePlanAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("domain_connection.dns_plan_simulate", () =>
    services.simulateDnsChangePlan(user.id, tenant.id, text(formData, "planId")),
  );
  revalidatePath("/connexions/domaines");
}

export async function startMockOAuthConnectionAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const result = await safeServerAction("oauth.connection_start", () =>
    services.startMockOAuthConnection(user.id, tenant.id, {
      accountLabel: text(formData, "accountLabel"),
      scopes: ["contacts.read", "profile.read"],
    }),
  );
  redirect(result.authorizationUrl);
}

export async function authorizeMockOAuthAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const result = await safeServerAction("oauth.authorization_grant", () =>
    services.authorizeMockOAuthRequest(user.id, tenant.id, {
      state: text(formData, "state"),
      codeChallenge: text(formData, "codeChallenge"),
      redirectUri: text(formData, "redirectUri"),
    }),
  );
  redirect(result.callbackUrl);
}

export async function rejectMockOAuthAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("oauth.authorization_reject", () =>
    services.disconnectSoftwareConnection(
      user.id,
      tenant.id,
      text(formData, "connectionId"),
    ),
  );
  revalidatePath("/connexions/logiciels");
  redirect("/connexions/logiciels?oauth=refuse");
}

export async function refreshMockOAuthCredentialAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("oauth.credential_refresh", () =>
    services.refreshMockOAuthCredential(
      user.id,
      tenant.id,
      text(formData, "connectionId"),
    ),
  );
  revalidatePath("/connexions/logiciels");
}

export async function disconnectSoftwareConnectionAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("software_connection.disconnect", () =>
    services.disconnectSoftwareConnection(
      user.id,
      tenant.id,
      text(formData, "connectionId"),
    ),
  );
  revalidatePath("/connexions/logiciels");
  revalidatePath("/connexions");
}

export async function prepareMockConnectorInstallationAction(
  formData: FormData,
) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("connector.installation_prepare", () =>
    services.prepareMockConnectorInstallation(
      user.id,
      tenant.id,
      text(formData, "connectionId"),
    ),
  );
  revalidatePath("/connexions/logiciels");
}

export async function enableMockConnectorReadOnlyAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("connector.read_only_enable", () =>
    services.enableMockConnectorReadOnly(
      user.id,
      tenant.id,
      text(formData, "installationId"),
    ),
  );
  revalidatePath("/connexions/logiciels");
}

export async function executeMockConnectorReadOnlyAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("connector.read_only_execute", () =>
    services.executeMockConnectorOperation(user.id, tenant.id, {
      installationId: text(formData, "installationId"),
      operation: "contacts.list",
      capability: "read",
      environment: "mock",
      idempotencyKey: id("connector_sync"),
      correlationId: randomUUID(),
    }),
  );
  revalidatePath("/connexions/logiciels");
  revalidatePath("/connexions");
  revalidatePath("/aujourdhui");
}

export async function rotateWebhookSecretAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("connector.webhook_secret_rotate", () =>
    services.rotateWebhookEndpointSecret(
      user.id,
      tenant.id,
      text(formData, "endpointId"),
      text(formData, "secret"),
    ),
  );
  revalidatePath("/connexions");
}

export type GeneratedWebhookSecretState = {
  secret: string | null;
  error: string | null;
};

export async function generateWebhookSecretAction(
  _state: GeneratedWebhookSecretState,
  formData: FormData,
): Promise<GeneratedWebhookSecretState> {
  try {
    const { user, tenant } = await requireTenantContext();
    const services = await getServices();
    const result = await safeServerAction(
      "connector.webhook_secret_generate",
      () =>
        services.generateWebhookEndpointSecret(
          user.id,
          tenant.id,
          text(formData, "endpointId"),
        ),
    );
    revalidatePath("/connexions");

    return { secret: result.secret, error: null };
  } catch {
    return { secret: null, error: "Rotation du secret impossible." };
  }
}

export async function setWebhookEndpointStatusAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("connector.webhook_status", () =>
    services.setWebhookEndpointStatus(
      user.id,
      tenant.id,
      text(formData, "endpointId"),
      text(formData, "status") as "active" | "disabled",
    ),
  );
  revalidatePath("/connexions");
  revalidatePath("/aujourdhui");
}

export async function createApiIntelligenceSoftwareAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("api_intelligence.software_create", () =>
    services.createSoftwareDirectoryEntry(user.id, tenant.id, {
      canonicalName: text(formData, "canonicalName"),
      aliases: list(formData, "aliases"),
      vendor: text(formData, "vendor"),
      officialDomain: text(formData, "officialDomain"),
      country: text(formData, "country") || undefined,
      supportedRegions: list(formData, "supportedRegions"),
      languages: list(formData, "languages"),
      industries: list(formData, "industries"),
      categories: list(formData, "categories"),
      officialWebsite: text(formData, "officialWebsite"),
      developerPortal: text(formData, "developerPortal") || undefined,
    }),
  );
  revalidatePath("/intelligence-api");
}

export async function decideApiIntelligenceDomainAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("api_intelligence.domain_decide", () =>
    services.decideSoftwareDomain(user.id, tenant.id, {
      domainId: text(formData, "domainId"),
      status: text(formData, "status") as "approved" | "denied" | "paused",
      reason: text(formData, "reason"),
    }),
  );
  revalidatePath("/intelligence-api");
}

export async function scanApiIntelligenceDomainAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("api_intelligence.domain_scan", () =>
    services.scanApprovedSoftwareDomain(user.id, tenant.id, {
      domainId: text(formData, "domainId"),
    }),
  );
  revalidatePath("/intelligence-api");
}

export async function decideApiDiscoveryCandidateAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const status = text(formData, "status") as "accepted" | "rejected";
  await safeServerAction("api_intelligence.discovery_candidate_decide", () =>
    services.decideApiDiscoveryCandidate(user.id, tenant.id, {
      candidateId: text(formData, "candidateId"),
      status,
      apiProductId: text(formData, "apiProductId") || undefined,
      reason: text(formData, "reason"),
    }),
  );
  revalidatePath("/intelligence-api");
}

export async function createApiIntelligenceProductAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("api_intelligence.product_create", () =>
    services.createApiProductRecord(user.id, tenant.id, {
      softwareId: text(formData, "softwareId"),
      name: text(formData, "name"),
      apiStyle: text(formData, "apiStyle") as
        | "rest"
        | "graphql"
        | "webhook"
        | "other",
      version: text(formData, "version"),
      documentationUrl: text(formData, "documentationUrl"),
    }),
  );
  revalidatePath("/intelligence-api");
}

export async function addApiIntelligenceSourceAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("api_intelligence.source_add", () =>
    services.addOfficialApiSource(user.id, tenant.id, {
      softwareId: text(formData, "softwareId"),
      apiProductId: text(formData, "apiProductId") || undefined,
      url: text(formData, "url"),
      sourceType: sourceTypeSchema.parse(text(formData, "sourceType")),
    }),
  );
  revalidatePath("/intelligence-api");
}

export async function fetchApiIntelligenceSourceAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("api_intelligence.source_fetch", () =>
    services.fetchApprovedApiSource(
      user.id,
      tenant.id,
      text(formData, "sourceId"),
    ),
  );
  revalidatePath("/intelligence-api");
}

export async function configureApiSourceRecheckAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("api_intelligence.recheck_configure", () =>
    services.configureApiSourceRecheck(user.id, tenant.id, {
      sourceId: text(formData, "sourceId"),
      enabled: text(formData, "enabled") === "true",
      intervalSeconds: Number(text(formData, "intervalSeconds")),
    }),
  );
  revalidatePath("/intelligence-api");
}

export async function importApiIntelligenceSnapshotAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const input = {
    snapshotId: text(formData, "snapshotId"),
    apiProductId: text(formData, "apiProductId"),
  };
  await safeServerAction("api_intelligence.source_import", async () => {
    const preview = await services.previewApiSnapshot(
      user.id,
      tenant.id,
      input,
    );
    return services.persistApiPreview(user.id, tenant.id, preview);
  });
  revalidatePath("/intelligence-api");
}

export async function decideApiIntelligenceClaimAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("api_intelligence.claim_decide", () =>
    services.decideApiClaim(user.id, tenant.id, {
      claimId: text(formData, "claimId"),
      status: text(formData, "status") as "approved" | "rejected",
      reason: text(formData, "reason"),
    }),
  );
  revalidatePath("/intelligence-api");
}

export async function proposeApiIntelligenceMappingAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("api_intelligence.mapping_propose", () =>
    services.proposeTenantOntologyMapping(user.id, tenant.id, {
      apiProductId: text(formData, "apiProductId"),
      sourceEntity: text(formData, "sourceEntity"),
      canonicalEntity: canonicalEntitySchema.parse(
        text(formData, "canonicalEntity"),
      ),
      confidence: Number.parseInt(text(formData, "confidence"), 10),
      evidenceId: text(formData, "evidenceId"),
    }),
  );
  revalidatePath("/intelligence-api");
}

export async function decideApiIntelligenceMappingAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("api_intelligence.mapping_decide", () =>
    services.decideTenantOntologyMapping(user.id, tenant.id, {
      mappingId: text(formData, "mappingId"),
      status: text(formData, "status") as "approved" | "rejected",
    }),
  );
  revalidatePath("/intelligence-api");
}

export async function promoteApiIntelligenceMappingAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("api_intelligence.mapping_promote", () =>
    services.promoteApprovedTenantMapping(user.id, tenant.id, {
      mappingId: text(formData, "mappingId"),
      reason: text(formData, "reason"),
    }),
  );
  revalidatePath("/intelligence-api");
}

export async function reuseApiIntelligenceMappingAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("api_intelligence.mapping_reuse", () =>
    services.proposeTenantMappingFromGlobal(user.id, tenant.id, {
      globalMappingId: text(formData, "globalMappingId"),
    }),
  );
  revalidatePath("/intelligence-api");
}

export async function runApiCompatibilityCheckAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("api_intelligence.compatibility_check", () =>
    services.runCompatibilityCheck(user.id, tenant.id, {
      softwareId: text(formData, "softwareId"),
      apiProductId: text(formData, "apiProductId"),
      tenantIndustry: text(formData, "tenantIndustry"),
      desiredAutomation: text(formData, "desiredAutomation"),
    }),
  );
  revalidatePath("/intelligence-api");
}

export async function generateApiConnectorProposalAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("connector_copilot.proposal_generate", () =>
    services.generateConnectorProposal(user.id, tenant.id, {
      compatibilityCheckId: text(formData, "compatibilityCheckId"),
      name: text(formData, "name"),
    }),
  );
  revalidatePath("/intelligence-api");
}

export async function runApiConnectorContractAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("connector_copilot.contract_run", () =>
    services.runMockContractTests(
      user.id,
      tenant.id,
      text(formData, "proposalId"),
    ),
  );
  revalidatePath("/intelligence-api");
}

export async function submitApiConnectorApprovalAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("connector_copilot.approval_submit", () =>
    services.submitConnectorForSandboxApproval(
      user.id,
      tenant.id,
      text(formData, "proposalId"),
    ),
  );
  revalidatePath("/intelligence-api");
}

export async function decideApiConnectorApprovalAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("connector_copilot.approval_decide", () =>
    services.decideConnectorSandboxApproval(user.id, tenant.id, {
      approvalId: text(formData, "approvalId"),
      decision: text(formData, "decision") as "approved" | "rejected",
      reason: text(formData, "reason"),
    }),
  );
  revalidatePath("/intelligence-api");
}

export async function prepareConnectorInstallationPlanAction(
  formData: FormData,
) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("universal_connector.installation_plan_prepare", () =>
    services.prepareConnectorInstallationPlan(user.id, tenant.id, {
      storeEntryId: text(formData, "storeEntryId"),
    }),
  );
  revalidatePath("/connexions");
}

export async function refreshPrivateAppMarketplaceAction() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("app_marketplace.private_catalog_refresh", () =>
    services.refreshPrivateAppMarketplace(user.id, tenant.id),
  );
  revalidatePath("/catalogue");
}

export async function previewPrivateMarketplaceInstallationAction(
  formData: FormData,
) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("app_marketplace.installation_preview", () =>
    services.previewPrivateMarketplaceInstallation(user.id, tenant.id, {
      listingId: text(formData, "listingId"),
    }),
  );
  revalidatePath("/catalogue");
}

export async function createPrivateAutomationPackageAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("automation_marketplace.package_create", () =>
    services.createPrivateAutomationPackage(user.id, tenant.id, {
      listingId: text(formData, "listingId"),
    }),
  );
  revalidatePath("/bibliotheque-automatisations");
}

export async function previewPrivateAutomationPackageAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("automation_marketplace.package_preview", () =>
    services.previewPrivateAutomationPackage(user.id, tenant.id, {
      packageId: text(formData, "packageId"),
    }),
  );
  revalidatePath("/bibliotheque-automatisations");
}

export async function generateSelfImprovementProposalsAction() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("self_improvement.generate", () =>
    services.generateSelfImprovementProposals(user.id, tenant.id),
  );
  revalidatePath("/ameliorations");
}

export async function decideSelfImprovementProposalAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("self_improvement.decide", () =>
    services.decideSelfImprovementProposal(user.id, tenant.id, {
      proposalId: text(formData, "proposalId"),
      decision: text(formData, "decision") as "accepted" | "dismissed",
      reason: text(formData, "reason"),
    }),
  );
  revalidatePath("/ameliorations");
}

export async function decideApiChangeRepairAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("api_intelligence.change_repair_decide", () =>
    services.decideApiChangeRepair(user.id, tenant.id, {
      impactId: text(formData, "impactId"),
      decision: text(formData, "decision") as "approved" | "rejected",
      reason: text(formData, "reason"),
    }),
  );
  revalidatePath("/intelligence-api");
  revalidatePath("/aujourdhui");
}

export async function generateApiChangeRepairAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("api_intelligence.change_repair_generate", () =>
    services.generateApprovedConnectorRepair(user.id, tenant.id, {
      impactId: text(formData, "impactId"),
    }),
  );
  revalidatePath("/intelligence-api");
  revalidatePath("/aujourdhui");
}

export async function seedDemoAction() {
  if (!isPublicDemoEnabled()) {
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

function list(formData: FormData, key: string) {
  return text(formData, key)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function moneyToCents(value: string) {
  const amount = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function optionalMoneyToCents(value: string) {
  return value ? strictMoneyToCents(value) : null;
}

function strictMoneyToCents(value: string) {
  const amount = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
}

function integerValue(formData: FormData, key: string) {
  const value = Number.parseInt(text(formData, key), 10);
  return Number.isFinite(value) ? value : Number.NaN;
}

function optionalIntegerValue(formData: FormData, key: string) {
  const raw = text(formData, key);
  return raw ? integerValue(formData, key) : null;
}

function mergeFieldSource(
  formData: FormData,
  key: string,
  survivorContactId: string,
) {
  const value = text(formData, key);
  return value && value !== survivorContactId ? "merged" : "survivor";
}
