import { z } from "zod";
import { getDb, migrate, type DbClient } from "@/lib/db";
import { defaultGarageOnboarding } from "@/lib/generation";
import {
  generateWebhookEndpointSecretRotation,
  getConnectors,
  getWebhookEndpointConfig,
  importCsvContacts,
  receiveWebhook,
  rotateWebhookEndpointSecret,
  setWebhookEndpointStatus,
  syncMockConnector,
  type WebhookSignatureInput,
} from "@/modules/connectors";
import {
  addContactNote,
  completeContactTask,
  contactMergeSchema,
  contactConsentSchema,
  contactNoteSchema,
  contactTaskSchema,
  contactUpdateSchema,
  createContactTask,
  findContactForTenant,
  getContactDetail,
  getContactDuplicateCandidates,
  getCrm,
  getDuplicatePairDetail,
  getOpportunities,
  getOpportunityDetail,
  mergeContacts,
  opportunityFiltersSchema,
  opportunityUpdateSchema,
  submitPublicLead as submitPublicLeadDomain,
  updateContactProfile,
  updateOpportunity,
  upsertContactConsent,
} from "@/modules/crm";
import {
  createSession,
  getSessionUser,
  loginSchema,
  loginUser,
  mapUser,
  passwordResetRequestSchema,
  passwordResetSchema,
  registerUser,
  registrationSchema,
  requestPasswordReset,
  resetPassword,
  revokeSession,
  type UserRow,
} from "@/modules/auth";
import {
  getBusinessTwin,
  onboardingSchema,
  saveBusinessTwin,
} from "@/modules/business-twin";
import { getAuditLogs } from "@/modules/audit";
import { getDashboardData } from "@/modules/dashboard";
import {
  acceptInvitation,
  acceptInvitationForUser,
  assertTenantAccess,
  createInvitation,
  createTenant as createTenantDomain,
  getPendingInvitations,
  getTenantContext,
  getTenantMembers,
  getUserTenants,
  invitationSchema,
  orgSchema,
  resendInvitation,
  updateMemberRole,
  updateMemberRoleSchema,
  acceptInvitationSchema,
} from "@/modules/tenants";
import { createDefaultTenantResources } from "@/modules/tenants/provisioning";
import {
  getPublishedSite,
  getWebsite,
  getWebsiteWorkspace,
  moveWebsiteSection,
  publishWebsite,
  restoreWebsiteVersion,
  updateWebsiteSection,
} from "@/modules/websites";
import {
  dismissOpportunityRadarAlert,
  getOpportunityRadar,
} from "@/modules/opportunity-radar";
import {
  approveWorkflowRun,
  cancelWorkflowQueueEvent,
  cancelWorkflowRun,
  getWorkflowDeadLetters,
  getWorkflowQueueOverview,
  getWorkflowRuns,
  rejectWorkflowRun,
  retryWorkflowDeadLetter,
  requestManualWorkflowRetry,
} from "@/modules/workflows";
import type { User } from "@/lib/types";
import { enforceRateLimit, rateLimitPolicies } from "@/modules/rate-limit";
import {
  authLinkPreviewEnabled,
  createRuntimeEmailProvider,
  resolveAppUrl,
  type EmailProvider,
} from "@/modules/email";

export type ServiceDependencies = {
  emailProvider?: EmailProvider;
  appUrl?: string;
  revealAuthLinks?: boolean;
};

export async function getServices() {
  const db = await getDb();
  await migrate(db);
  return createServices(db);
}

export function createServices(
  db: DbClient,
  dependencies: ServiceDependencies = {},
) {
  const authDelivery = {
    emailProvider: dependencies.emailProvider ?? createRuntimeEmailProvider(),
    appUrl: resolveAppUrl(dependencies.appUrl),
    revealAuthLink:
      dependencies.revealAuthLinks ?? authLinkPreviewEnabled(),
  };

  return {
    registerUser: (input: z.input<typeof registrationSchema>) =>
      registerUser(db, input),
    loginUser: (input: z.input<typeof loginSchema>) => loginUser(db, input),
    requestPasswordReset: (input: z.input<typeof passwordResetRequestSchema>) =>
      requestPasswordReset(db, input, authDelivery),
    resetPassword: (input: z.input<typeof passwordResetSchema>) =>
      resetPassword(db, input),
    createSession: (userId: string) => createSession(db, userId),
    getSessionUser: (sessionId?: string) => getSessionUser(db, sessionId),
    revokeSession: (sessionToken?: string) => revokeSession(db, sessionToken),
    createTenant: (userId: string, input: z.input<typeof orgSchema>) =>
      createTenantDomain(db, userId, input, {
        createDefaults: createDefaultTenantResources,
      }),
    switchTenant: (userId: string, tenantId: string) =>
      assertTenantAccess(db, userId, tenantId),
    getUserTenants: (userId: string) => getUserTenants(db, userId),
    getTenantContext: (userId: string, preferredTenantId?: string) =>
      getTenantContext(db, userId, preferredTenantId),
    getTenantMembers: (userId: string, tenantId: string) =>
      getTenantMembers(db, userId, tenantId),
    getPendingInvitations: (userId: string, tenantId: string) =>
      getPendingInvitations(db, userId, tenantId),
    createInvitation: (
      userId: string,
      tenantId: string,
      input: z.input<typeof invitationSchema>,
    ) => createInvitation(db, userId, tenantId, input, authDelivery),
    resendInvitation: (
      userId: string,
      tenantId: string,
      invitationId: string,
    ) => resendInvitation(db, userId, tenantId, invitationId, authDelivery),
    acceptInvitation: (input: z.input<typeof acceptInvitationSchema>) =>
      acceptInvitation(db, input),
    acceptInvitationForUser: (userId: string, token: string) =>
      acceptInvitationForUser(db, userId, token),
    updateMemberRole: (
      userId: string,
      tenantId: string,
      input: z.input<typeof updateMemberRoleSchema>,
    ) => updateMemberRole(db, userId, tenantId, input),
    saveOnboarding: (
      userId: string,
      tenantId: string,
      input: z.input<typeof onboardingSchema>,
    ) => saveBusinessTwin(db, userId, tenantId, input),
    getOnboarding: (userId: string, tenantId: string) =>
      getBusinessTwin(db, userId, tenantId),
    getWebsiteWorkspace: (userId: string, tenantId: string) =>
      getWebsiteWorkspace(db, userId, tenantId),
    updateWebsiteSection: (
      userId: string,
      tenantId: string,
      sectionId: string,
      input: {
        title: string;
        body: string;
        imageUrl?: string;
        buttonLabel?: string;
        buttonHref?: string;
        enabled: boolean;
      },
    ) => updateWebsiteSection(db, userId, tenantId, sectionId, input),
    moveWebsiteSection: (
      userId: string,
      tenantId: string,
      sectionId: string,
      direction: "up" | "down",
    ) => moveWebsiteSection(db, userId, tenantId, sectionId, direction),
    publishWebsite: (userId: string, tenantId: string) =>
      publishWebsite(db, userId, tenantId),
    restoreWebsiteVersion: (
      userId: string,
      tenantId: string,
      versionId: string,
    ) => restoreWebsiteVersion(db, userId, tenantId, versionId),
    getPublishedSite: (slug: string) => getPublishedSite(db, slug),
    submitPublicLead: (
      slug: string,
      payload: {
        name: string;
        email: string;
        phone: string;
        message: string;
        idempotencyKey?: string;
      },
    ) =>
      submitPublicLeadDomain(db, slug, payload, {
        getPublishedSite,
      }),
    getDashboard: (userId: string, tenantId: string) =>
      getDashboardData(db, userId, tenantId),
    getOpportunityRadar: (userId: string, tenantId: string) =>
      getOpportunityRadar(db, userId, tenantId),
    dismissOpportunityRadarAlert: (
      userId: string,
      tenantId: string,
      alertId: string,
    ) => dismissOpportunityRadarAlert(db, userId, tenantId, { alertId }),
    getCrm: (userId: string, tenantId: string) => getCrm(db, userId, tenantId),
    getOpportunities: (
      userId: string,
      tenantId: string,
      input: z.input<typeof opportunityFiltersSchema> = {},
    ) => getOpportunities(db, userId, tenantId, input),
    getOpportunityDetail: (
      userId: string,
      tenantId: string,
      opportunityId: string,
    ) => getOpportunityDetail(db, userId, tenantId, opportunityId),
    updateOpportunity: (
      userId: string,
      tenantId: string,
      opportunityId: string,
      input: z.input<typeof opportunityUpdateSchema>,
    ) => updateOpportunity(db, userId, tenantId, opportunityId, input),
    getContactDetail: (userId: string, tenantId: string, contactId: string) =>
      getContactDetail(db, userId, tenantId, contactId),
    getContactDuplicateCandidates: (userId: string, tenantId: string) =>
      getContactDuplicateCandidates(db, userId, tenantId),
    getDuplicatePairDetail: (
      userId: string,
      tenantId: string,
      leftContactId: string,
      rightContactId: string,
    ) =>
      getDuplicatePairDetail(
        db,
        userId,
        tenantId,
        leftContactId,
        rightContactId,
      ),
    mergeContacts: (
      userId: string,
      tenantId: string,
      input: z.input<typeof contactMergeSchema>,
    ) => mergeContacts(db, userId, tenantId, input),
    updateContact: (
      userId: string,
      tenantId: string,
      contactId: string,
      input: z.input<typeof contactUpdateSchema>,
    ) => updateContactProfile(db, userId, tenantId, contactId, input),
    updateContactConsent: (
      userId: string,
      tenantId: string,
      contactId: string,
      input: z.input<typeof contactConsentSchema>,
    ) => upsertContactConsent(db, userId, tenantId, contactId, input),
    addContactNote: (
      userId: string,
      tenantId: string,
      contactId: string,
      input: z.input<typeof contactNoteSchema>,
    ) => addContactNote(db, userId, tenantId, contactId, input),
    createContactTask: (
      userId: string,
      tenantId: string,
      contactId: string,
      input: z.input<typeof contactTaskSchema>,
    ) => createContactTask(db, userId, tenantId, contactId, input),
    completeContactTask: (
      userId: string,
      tenantId: string,
      contactId: string,
      taskId: string,
    ) => completeContactTask(db, userId, tenantId, contactId, { taskId }),
    getConnectors: (userId: string, tenantId: string) =>
      getConnectors(db, userId, tenantId),
    importCsvContacts: (userId: string, tenantId: string, csvText: string) =>
      importCsvContacts(db, userId, tenantId, csvText),
    syncMockConnector: (userId: string, tenantId: string) =>
      syncMockConnector(db, userId, tenantId),
    getWebhookEndpointConfig: (userId: string, tenantId: string) =>
      getWebhookEndpointConfig(db, userId, tenantId),
    rotateWebhookEndpointSecret: (
      userId: string,
      tenantId: string,
      endpointId: string,
      secret: string,
    ) =>
      rotateWebhookEndpointSecret(db, userId, tenantId, {
        endpointId,
        secret,
      }),
    generateWebhookEndpointSecret: (
      userId: string,
      tenantId: string,
      endpointId: string,
    ) =>
      generateWebhookEndpointSecretRotation(db, userId, tenantId, {
        endpointId,
      }),
    setWebhookEndpointStatus: (
      userId: string,
      tenantId: string,
      endpointId: string,
      status: "active" | "disabled",
    ) => setWebhookEndpointStatus(db, userId, tenantId, { endpointId, status }),
    receiveWebhook: (
      token: string,
      payload: Record<string, unknown>,
      signatureInput?: WebhookSignatureInput,
    ) => receiveWebhook(db, token, payload, signatureInput),
    getWorkflowRuns: (userId: string, tenantId: string) =>
      getWorkflowRuns(db, userId, tenantId),
    getWorkflowDeadLetters: (userId: string, tenantId: string) =>
      getWorkflowDeadLetters(db, userId, tenantId),
    getWorkflowQueueOverview: (userId: string, tenantId: string) =>
      getWorkflowQueueOverview(db, userId, tenantId),
    cancelWorkflowRun: (userId: string, tenantId: string, runId: string) =>
      cancelWorkflowRun(db, userId, tenantId, { runId }),
    approveWorkflowRun: (userId: string, tenantId: string, runId: string) =>
      approveWorkflowRun(db, userId, tenantId, { runId }),
    rejectWorkflowRun: (userId: string, tenantId: string, runId: string) =>
      rejectWorkflowRun(db, userId, tenantId, { runId }),
    requestManualWorkflowRetry: (
      userId: string,
      tenantId: string,
      runId: string,
    ) => requestManualWorkflowRetry(db, userId, tenantId, { runId }),
    retryWorkflowDeadLetter: (
      userId: string,
      tenantId: string,
      eventId: string,
    ) => retryWorkflowDeadLetter(db, userId, tenantId, { eventId }),
    cancelWorkflowQueueEvent: (
      userId: string,
      tenantId: string,
      eventId: string,
    ) => cancelWorkflowQueueEvent(db, userId, tenantId, { eventId }),
    getAuditLogs: (userId: string, tenantId: string) =>
      getAuditLogs(db, userId, tenantId),
    seedDemo: () => seedDemo(db),
    findContactForTenant: (
      userId: string,
      tenantId: string,
      contactId: string,
    ) => findContactForTenant(db, userId, tenantId, contactId),
  };
}

async function seedDemo(db: DbClient) {
  await enforceRateLimit(db, {
    operationKey: "demo.seed",
    subjectKey: "shared-public-demo",
    scopeKey: process.env.NODE_ENV ?? "development",
    limit: rateLimitPolicies.publicDemo.limit,
    windowSeconds: rateLimitPolicies.publicDemo.windowSeconds,
  });
  const email = "patron@garage-caraibes-auto.example";
  const existing = await db.query<UserRow>("select * from users where email = $1", [email]);
  let user: User;

  if (existing.rows[0]) {
    user = mapUser(existing.rows[0]);
  } else {
    user = await registerUser(db, {
      name: "Malia Occo",
      email,
      password: "Tradikom!2026",
    });
  }

  const tenants = await getUserTenants(db, user.id);
  let tenant = tenants[0]?.tenant;

  if (!tenant) {
    tenant = await createTenantDomain(
      db,
      user.id,
      {
        name: "Garage Caraibes Auto",
        category: "Garage automobile",
      },
      { createDefaults: createDefaultTenantResources },
    );
  }

  const profile = await getBusinessTwin(db, user.id, tenant.id);
  if (!profile) {
    await saveBusinessTwin(db, user.id, tenant.id, defaultGarageOnboarding());
  }

  const website = await getWebsite(db, tenant.id);
  if (website?.status !== "published") {
    await publishWebsite(db, user.id, tenant.id);
  }

  const contacts = await db.query("select id from contacts where tenant_id = $1 limit 1", [
    tenant.id,
  ]);
  if (contacts.rows.length === 0) {
    await submitPublicLeadDomain(
      db,
      tenant.slug,
      {
        name: "Jonathan Pelage",
        email: "jonathan.pelage@example.com",
        phone: "+596 696 11 22 33",
        message: "Bonjour, je souhaite un devis pour un diagnostic climatisation.",
      },
      { getPublishedSite },
    );
  }

  return { user, tenant, password: "Tradikom!2026" };
}
