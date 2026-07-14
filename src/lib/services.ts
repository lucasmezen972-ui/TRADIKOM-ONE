import { z } from "zod";
import { getDb, migrate, type DbClient } from "@/lib/db";
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
  passwordResetRequestSchema,
  passwordResetSchema,
  registerUser,
  registrationSchema,
  requestPasswordReset,
  resetPassword,
  revokeSession,
} from "@/modules/auth";
import {
  getBusinessTwin,
  onboardingSchema,
  saveBusinessTwin,
} from "@/modules/business-twin";
import {
  archiveBusinessBrainEntry,
  archiveBusinessBrainEntrySchema,
  createBusinessBrainEntry,
  createBusinessBrainEntrySchema,
  getBusinessBrain,
  reviseBusinessBrainEntry,
  reviseBusinessBrainEntrySchema,
} from "@/modules/business-brain";
import {
  decideMarketingProposal,
  generateMarketingCampaignProposals,
  getAutonomousMarketing,
  marketingProposalDecisionSchema,
  reviseMarketingProposal,
  reviseMarketingProposalSchema,
  submitMarketingProposalForApproval,
  submitMarketingProposalSchema,
} from "@/modules/autonomous-marketing";
import { getAuditLogs } from "@/modules/audit";
import { getDashboardData } from "@/modules/dashboard";
import { seedDemo } from "@/modules/demo";
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
import {
  authLinkPreviewEnabled,
  createRuntimeEmailProvider,
  resolveAppUrl,
  type EmailProvider,
} from "@/modules/email";
import {
  addOfficialApiSource,
  createApiProductRecord,
  createSoftwareDirectoryEntry,
  decideSoftwareDomain,
  getSoftwareDirectory,
  type ApiProductInput,
  type ApiSourceInput,
  type SoftwareInput,
} from "@/modules/software-directory";
import {
  decideTenantOntologyMapping,
  decideApiChangeRepair,
  decideApiClaim,
  decideApiDiscoveryCandidate,
  fetchApprovedApiSource,
  configureApiSourceRecheck,
  getApiIntelligenceWorkspace,
  getApiIntelligenceObservability,
  getLatestCompatibilityCheck,
  generateApprovedConnectorRepair,
  persistApiPreview,
  persistOpenApiPreview,
  persistPostmanPreview,
  previewApiSnapshot,
  previewOpenApiSnapshot,
  previewPostmanSnapshot,
  promoteApprovedTenantMapping,
  proposeTenantOntologyMapping,
  proposeTenantMappingFromGlobal,
  runCompatibilityCheck,
  scanApprovedSoftwareDomain,
  type DiscoveryTransport,
  type ApiSourceRecheckConfiguration,
  type OntologyMappingInput,
  type ApiContractPreview,
  type OpenApiPreview,
  type PostmanPreview,
} from "@/modules/api-intelligence";
import {
  decideConnectorSandboxApproval,
  generateConnectorProposal,
  getPrivateConnectStore,
  runMockContractTests,
  submitConnectorForSandboxApproval,
  type MockContractExecutor,
} from "@/modules/connector-copilot";
import { isPlatformAdmin } from "@/modules/platform-admin";
import {
  decideStrategicRecommendation,
  generateStrategicRecommendations,
  getStrategicAdvisor,
  strategicRecommendationDecisionSchema,
} from "@/modules/strategic-advisor";
import {
  applyApprovedWebsiteAiProposal,
  decideWebsiteAiProposal,
  generateWebsiteAiProposals,
  getWebsiteAiWorkspace,
  submitWebsiteAiProposalForApproval,
  websiteAiProposalDecisionSchema,
  websiteAiProposalReferenceSchema,
} from "@/modules/website-ai";
import {
  generateSalesAiAssessments,
  getSalesAiWorkspace,
} from "@/modules/sales-ai";
import {
  createReputationReview,
  decideReputationProposal,
  generateReputationProposals,
  getReputationWorkspace,
  reputationProposalDecisionSchema,
  reputationProposalReferenceSchema,
  reputationReviewSchema,
  submitReputationProposalForApproval,
} from "@/modules/reputation-ai";
import {
  competitorInsightDecisionSchema,
  competitorInsightReferenceSchema,
  competitorObservationSchema,
  competitorProfileSchema,
  createCompetitorObservation,
  createCompetitorProfile,
  decideCompetitorInsight,
  generateCompetitorInsights,
  getCompetitorIntelligenceWorkspace,
  submitCompetitorInsightForApproval,
} from "@/modules/competitor-intelligence";

export type ServiceDependencies = {
  emailProvider?: EmailProvider;
  appUrl?: string;
  revealAuthLinks?: boolean;
  discoveryTransport?: DiscoveryTransport;
  mockContractExecutor?: MockContractExecutor;
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
    getBusinessBrain: (userId: string, tenantId: string) =>
      getBusinessBrain(db, userId, tenantId),
    createBusinessBrainEntry: (
      userId: string,
      tenantId: string,
      input: z.input<typeof createBusinessBrainEntrySchema>,
    ) => createBusinessBrainEntry(db, userId, tenantId, input),
    reviseBusinessBrainEntry: (
      userId: string,
      tenantId: string,
      input: z.input<typeof reviseBusinessBrainEntrySchema>,
    ) => reviseBusinessBrainEntry(db, userId, tenantId, input),
    archiveBusinessBrainEntry: (
      userId: string,
      tenantId: string,
      input: z.input<typeof archiveBusinessBrainEntrySchema>,
    ) => archiveBusinessBrainEntry(db, userId, tenantId, input),
    getStrategicAdvisor: (userId: string, tenantId: string) =>
      getStrategicAdvisor(db, userId, tenantId),
    generateStrategicRecommendations: (userId: string, tenantId: string) =>
      generateStrategicRecommendations(db, userId, tenantId),
    decideStrategicRecommendation: (
      userId: string,
      tenantId: string,
      input: z.input<typeof strategicRecommendationDecisionSchema>,
    ) => decideStrategicRecommendation(db, userId, tenantId, input),
    getAutonomousMarketing: (userId: string, tenantId: string) =>
      getAutonomousMarketing(db, userId, tenantId),
    generateMarketingCampaignProposals: (userId: string, tenantId: string) =>
      generateMarketingCampaignProposals(db, userId, tenantId),
    submitMarketingProposalForApproval: (
      userId: string,
      tenantId: string,
      input: z.input<typeof submitMarketingProposalSchema>,
    ) => submitMarketingProposalForApproval(db, userId, tenantId, input),
    decideMarketingProposal: (
      userId: string,
      tenantId: string,
      input: z.input<typeof marketingProposalDecisionSchema>,
    ) => decideMarketingProposal(db, userId, tenantId, input),
    reviseMarketingProposal: (
      userId: string,
      tenantId: string,
      input: z.input<typeof reviseMarketingProposalSchema>,
    ) => reviseMarketingProposal(db, userId, tenantId, input),
    getWebsiteAiWorkspace: (userId: string, tenantId: string) =>
      getWebsiteAiWorkspace(db, userId, tenantId),
    generateWebsiteAiProposals: (userId: string, tenantId: string) =>
      generateWebsiteAiProposals(db, userId, tenantId),
    submitWebsiteAiProposalForApproval: (
      userId: string,
      tenantId: string,
      input: z.input<typeof websiteAiProposalReferenceSchema>,
    ) => submitWebsiteAiProposalForApproval(db, userId, tenantId, input),
    decideWebsiteAiProposal: (
      userId: string,
      tenantId: string,
      input: z.input<typeof websiteAiProposalDecisionSchema>,
    ) => decideWebsiteAiProposal(db, userId, tenantId, input),
    applyApprovedWebsiteAiProposal: (
      userId: string,
      tenantId: string,
      input: z.input<typeof websiteAiProposalReferenceSchema>,
    ) => applyApprovedWebsiteAiProposal(db, userId, tenantId, input),
    getSalesAiWorkspace: (userId: string, tenantId: string) =>
      getSalesAiWorkspace(db, userId, tenantId),
    generateSalesAiAssessments: (userId: string, tenantId: string) =>
      generateSalesAiAssessments(db, userId, tenantId),
    getReputationWorkspace: (userId: string, tenantId: string) =>
      getReputationWorkspace(db, userId, tenantId),
    createReputationReview: (
      userId: string,
      tenantId: string,
      input: z.input<typeof reputationReviewSchema>,
    ) => createReputationReview(db, userId, tenantId, input),
    generateReputationProposals: (userId: string, tenantId: string) =>
      generateReputationProposals(db, userId, tenantId),
    submitReputationProposalForApproval: (
      userId: string,
      tenantId: string,
      input: z.input<typeof reputationProposalReferenceSchema>,
    ) => submitReputationProposalForApproval(db, userId, tenantId, input),
    decideReputationProposal: (
      userId: string,
      tenantId: string,
      input: z.input<typeof reputationProposalDecisionSchema>,
    ) => decideReputationProposal(db, userId, tenantId, input),
    getCompetitorIntelligenceWorkspace: (userId: string, tenantId: string) =>
      getCompetitorIntelligenceWorkspace(db, userId, tenantId),
    createCompetitorProfile: (
      userId: string,
      tenantId: string,
      input: z.input<typeof competitorProfileSchema>,
    ) => createCompetitorProfile(db, userId, tenantId, input),
    createCompetitorObservation: (
      userId: string,
      tenantId: string,
      input: z.input<typeof competitorObservationSchema>,
    ) => createCompetitorObservation(db, userId, tenantId, input),
    generateCompetitorInsights: (userId: string, tenantId: string) =>
      generateCompetitorInsights(db, userId, tenantId),
    submitCompetitorInsightForApproval: (
      userId: string,
      tenantId: string,
      input: z.input<typeof competitorInsightReferenceSchema>,
    ) => submitCompetitorInsightForApproval(db, userId, tenantId, input),
    decideCompetitorInsight: (
      userId: string,
      tenantId: string,
      input: z.input<typeof competitorInsightDecisionSchema>,
    ) => decideCompetitorInsight(db, userId, tenantId, input),
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
      getDashboardData(db, userId, tenantId, {
        timeZone: process.env.BUSINESS_TIME_ZONE,
      }),
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
    isPlatformAdmin: (userId: string) => isPlatformAdmin(db, userId),
    getApiIntelligenceWorkspace: (userId: string, tenantId: string) =>
      getApiIntelligenceWorkspace(db, userId, tenantId),
    getSoftwareDirectory: (userId: string, tenantId: string) =>
      getSoftwareDirectory(db, userId, tenantId),
    createSoftwareDirectoryEntry: (
      userId: string,
      tenantId: string,
      input: SoftwareInput,
    ) => createSoftwareDirectoryEntry(db, userId, tenantId, input),
    decideSoftwareDomain: (
      userId: string,
      tenantId: string,
      input: {
        domainId: string;
        status: "approved" | "denied" | "paused";
        reason: string;
      },
    ) => decideSoftwareDomain(db, userId, tenantId, input),
    scanApprovedSoftwareDomain: (
      userId: string,
      tenantId: string,
      input: { domainId: string },
    ) =>
      scanApprovedSoftwareDomain(db, userId, tenantId, input, {
        transport: dependencies.discoveryTransport,
      }),
    decideApiDiscoveryCandidate: (
      userId: string,
      tenantId: string,
      input: {
        candidateId: string;
        status: "accepted" | "rejected";
        apiProductId?: string;
        reason: string;
      },
    ) => decideApiDiscoveryCandidate(db, userId, tenantId, input),
    createApiProductRecord: (
      userId: string,
      tenantId: string,
      input: ApiProductInput,
    ) => createApiProductRecord(db, userId, tenantId, input),
    addOfficialApiSource: (
      userId: string,
      tenantId: string,
      input: ApiSourceInput,
    ) => addOfficialApiSource(db, userId, tenantId, input),
    fetchApprovedApiSource: (
      userId: string,
      tenantId: string,
      sourceId: string,
    ) =>
      fetchApprovedApiSource(db, userId, tenantId, sourceId, {
        transport: dependencies.discoveryTransport,
      }),
    configureApiSourceRecheck: (
      userId: string,
      tenantId: string,
      input: ApiSourceRecheckConfiguration,
    ) => configureApiSourceRecheck(db, userId, tenantId, input),
    previewOpenApiSnapshot: (
      userId: string,
      tenantId: string,
      input: { snapshotId: string; apiProductId: string },
    ) => previewOpenApiSnapshot(db, userId, tenantId, input),
    previewPostmanSnapshot: (
      userId: string,
      tenantId: string,
      input: { snapshotId: string; apiProductId: string },
    ) => previewPostmanSnapshot(db, userId, tenantId, input),
    previewApiSnapshot: (
      userId: string,
      tenantId: string,
      input: { snapshotId: string; apiProductId: string },
    ) => previewApiSnapshot(db, userId, tenantId, input),
    persistOpenApiPreview: (
      userId: string,
      tenantId: string,
      preview: OpenApiPreview,
    ) => persistOpenApiPreview(db, userId, tenantId, preview),
    persistPostmanPreview: (
      userId: string,
      tenantId: string,
      preview: PostmanPreview,
    ) => persistPostmanPreview(db, userId, tenantId, preview),
    persistApiPreview: (
      userId: string,
      tenantId: string,
      preview: ApiContractPreview,
    ) => persistApiPreview(db, userId, tenantId, preview),
    proposeTenantOntologyMapping: (
      userId: string,
      tenantId: string,
      input: OntologyMappingInput,
    ) => proposeTenantOntologyMapping(db, userId, tenantId, input),
    decideTenantOntologyMapping: (
      userId: string,
      tenantId: string,
      input: { mappingId: string; status: "approved" | "rejected" },
    ) => decideTenantOntologyMapping(db, userId, tenantId, input),
    promoteApprovedTenantMapping: (
      userId: string,
      tenantId: string,
      input: { mappingId: string; reason: string },
    ) => promoteApprovedTenantMapping(db, userId, tenantId, input),
    proposeTenantMappingFromGlobal: (
      userId: string,
      tenantId: string,
      input: { globalMappingId: string },
    ) => proposeTenantMappingFromGlobal(db, userId, tenantId, input),
    decideApiClaim: (
      userId: string,
      tenantId: string,
      input: {
        claimId: string;
        status: "approved" | "rejected";
        reason: string;
      },
    ) => decideApiClaim(db, userId, tenantId, input),
    decideApiChangeRepair: (
      userId: string,
      tenantId: string,
      input: {
        impactId: string;
        decision: "approved" | "rejected";
        reason: string;
      },
    ) => decideApiChangeRepair(db, userId, tenantId, input),
    generateApprovedConnectorRepair: (
      userId: string,
      tenantId: string,
      input: { impactId: string },
    ) => generateApprovedConnectorRepair(db, userId, tenantId, input),
    runCompatibilityCheck: (
      userId: string,
      tenantId: string,
      input: {
        softwareId: string;
        apiProductId: string;
        tenantIndustry: string;
        desiredAutomation: string;
      },
    ) => runCompatibilityCheck(db, userId, tenantId, input),
    getLatestCompatibilityCheck: (userId: string, tenantId: string) =>
      getLatestCompatibilityCheck(db, userId, tenantId),
    getApiIntelligenceObservability: (
      userId: string,
      tenantId: string,
      now?: Date,
    ) => getApiIntelligenceObservability(db, userId, tenantId, now),
    generateConnectorProposal: (
      userId: string,
      tenantId: string,
      input: { compatibilityCheckId: string; name: string },
    ) => generateConnectorProposal(db, userId, tenantId, input),
    runMockContractTests: (
      userId: string,
      tenantId: string,
      proposalId: string,
    ) =>
      runMockContractTests(db, userId, tenantId, proposalId, {
        executor: dependencies.mockContractExecutor,
      }),
    submitConnectorForSandboxApproval: (
      userId: string,
      tenantId: string,
      proposalId: string,
    ) => submitConnectorForSandboxApproval(db, userId, tenantId, proposalId),
    decideConnectorSandboxApproval: (
      userId: string,
      tenantId: string,
      input: {
        approvalId: string;
        decision: "approved" | "rejected";
        reason: string;
      },
    ) => decideConnectorSandboxApproval(db, userId, tenantId, input),
    getPrivateConnectStore: (userId: string, tenantId: string) =>
      getPrivateConnectStore(db, userId, tenantId),
  };
}
