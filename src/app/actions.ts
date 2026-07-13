"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  clearSessionCookie,
  getSessionIdFromCookie,
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

export async function syncMockConnectorAction() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("connector.mock_sync", () =>
    services.syncMockConnector(user.id, tenant.id),
  );
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
      sourceType: "official_openapi_specification",
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

export async function importApiIntelligenceSnapshotAction(formData: FormData) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const input = {
    snapshotId: text(formData, "snapshotId"),
    apiProductId: text(formData, "apiProductId"),
  };
  await safeServerAction("api_intelligence.openapi_import", async () => {
    const preview = await services.previewOpenApiSnapshot(
      user.id,
      tenant.id,
      input,
    );
    return services.persistOpenApiPreview(user.id, tenant.id, preview);
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

function mergeFieldSource(
  formData: FormData,
  key: string,
  survivorContactId: string,
) {
  const value = text(formData, key);
  return value && value !== survivorContactId ? "merged" : "survivor";
}
