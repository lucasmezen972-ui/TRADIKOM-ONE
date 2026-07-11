import { z } from "zod";
import { getDb, migrate, type DbClient } from "@/lib/db";
import {
  buildBusinessTwin,
  defaultGarageOnboarding,
} from "@/lib/generation";
import {
  connectorCatalog,
  getConnectors,
  importCsvContacts,
  receiveWebhook,
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
  getTenantActivities,
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
import { recordAuditLog } from "@/modules/audit";
import {
  acceptInvitation,
  acceptInvitationForUser,
  assertTenantAccess,
  createInvitation,
  createTenant as createTenantDomain,
  getPendingInvitations,
  getTenantById,
  getTenantContext,
  getTenantMembers,
  getUserTenants,
  invitationSchema,
  orgSchema,
  updateMemberRole,
  updateMemberRoleSchema,
  acceptInvitationSchema,
} from "@/modules/tenants";
import {
  generateOrReplaceWebsite,
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
  id,
  nowIso,
  safeJson,
  toJson,
} from "@/lib/security";
import type {
  AuditLog,
  BusinessProfile,
  DashboardData,
  User,
  WorkflowRun,
} from "@/lib/types";

const pipelineStages = [
  "Nouveau contact",
  "A qualifier",
  "Rendez-vous prevu",
  "Devis envoye",
  "Gagne",
  "Perdu",
];

const onboardingSchema = z.object({
  companyName: z.string().min(2),
  category: z.string().min(2),
  description: z.string().min(10),
  services: z.string().min(2),
  products: z.string().default(""),
  targetCustomers: z.string().min(2),
  address: z.string().min(2),
  serviceAreas: z.string().min(2),
  phone: z.string().min(4),
  email: z.string().email(),
  openingHours: z.string().min(2),
  desiredCallsToAction: z.string().min(2),
  tone: z.string().min(2),
  colors: z.string().default(""),
  existingWebsite: z.string().default(""),
  socialLinks: z.string().default(""),
  photos: z.string().default(""),
  mainObjective: z.string().min(2),
  faqs: z.string().default(""),
  templateKey: z.enum(["artisan", "restaurant", "beauty"]),
});

export async function getServices() {
  const db = await getDb();
  await migrate(db);
  return createServices(db);
}

export function createServices(db: DbClient) {
  return {
    registerUser: (input: z.input<typeof registrationSchema>) =>
      registerUser(db, input),
    loginUser: (input: z.input<typeof loginSchema>) => loginUser(db, input),
    requestPasswordReset: (input: z.input<typeof passwordResetRequestSchema>) =>
      requestPasswordReset(db, input),
    resetPassword: (input: z.input<typeof passwordResetSchema>) =>
      resetPassword(db, input),
    createSession: (userId: string) => createSession(db, userId),
    getSessionUser: (sessionId?: string) => getSessionUser(db, sessionId),
    revokeSession: (sessionToken?: string) => revokeSession(db, sessionToken),
    createTenant: (userId: string, input: z.input<typeof orgSchema>) =>
      createTenantDomain(db, userId, input, {
        createDefaults: createTenantDefaults,
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
    ) => createInvitation(db, userId, tenantId, input),
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
    ) => saveOnboarding(db, userId, tenantId, input),
    getOnboarding: (userId: string, tenantId: string) =>
      getOnboarding(db, userId, tenantId),
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
      getDashboard(db, userId, tenantId),
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
    receiveWebhook: (
      token: string,
      payload: Record<string, unknown>,
      signatureInput?: WebhookSignatureInput,
    ) => receiveWebhook(db, token, payload, signatureInput),
    getWorkflowRuns: (userId: string, tenantId: string) =>
      getWorkflowRuns(db, userId, tenantId),
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

async function createTenantDefaults(db: DbClient, tenantId: string) {
  const now = nowIso();
  const pipelineId = id("pipeline");
  await db.query(
    "insert into pipelines (id, tenant_id, name, created_at) values ($1, $2, $3, $4)",
    [pipelineId, tenantId, "Pipeline commercial", now],
  );

  for (const [index, stage] of pipelineStages.entries()) {
    await db.query(
      "insert into pipeline_stages (id, tenant_id, pipeline_id, name, position) values ($1, $2, $3, $4, $5)",
      [id("stage"), tenantId, pipelineId, stage, index + 1],
    );
  }

  await db.query(
    `insert into workflows (id, tenant_id, workflow_key, name, trigger_name, status, approval_policy, definition, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id("workflow"),
      tenantId,
      "new_website_lead_follow_up",
      "Suivi automatique des nouveaux leads site",
      "lead.created",
      "active",
      "no_approval_required",
      toJson({
        conditions: ["source == website"],
        actions: ["create_task", "send_mock_email", "create_activity"],
        delays: [],
        approvalGateReady: true,
      }),
      now,
    ],
  );

  for (const connector of connectorCatalog.slice(0, 3)) {
    await db.query(
      `insert into connectors (id, tenant_id, connector_key, status, health, safe_config, last_sync_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id("connector"),
        tenantId,
        connector.key,
        connector.status,
        connector.health,
        toJson({ sandbox: true }),
        connector.lastSyncAt ?? null,
        now,
        now,
      ],
    );
  }

  await db.query(
    "insert into webhook_endpoints (id, tenant_id, token, secret_hash, status, created_at) values ($1, $2, $3, $4, $5, $6)",
    [id("webhook"), tenantId, id("wh"), null, "active", now],
  );
}

async function saveOnboarding(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: z.input<typeof onboardingSchema>,
) {
  await assertTenantAccess(db, userId, tenantId, [
    "owner",
    "administrator",
    "manager",
  ]);
  const parsed = onboardingSchema.parse(input);
  const profile = buildBusinessTwin(parsed);
  const now = nowIso();

  await db.query(
    `insert into business_profiles (tenant_id, data, onboarding_step, completed_at, updated_at)
     values ($1, $2, $3, $4, $5)
     on conflict (tenant_id) do update set data = excluded.data, onboarding_step = excluded.onboarding_step, completed_at = excluded.completed_at, updated_at = excluded.updated_at`,
    [tenantId, toJson(profile), 4, now, now],
  );

  await generateOrReplaceWebsite(db, tenantId, profile);
  await audit(db, tenantId, userId, "onboarding.completed", "business_profile", tenantId, {
    category: profile.identity.category,
  });

  return profile;
}

async function getOnboarding(db: DbClient, userId: string, tenantId: string) {
  await assertTenantAccess(db, userId, tenantId);
  const result = await db.query<{ data: string }>(
    "select data from business_profiles where tenant_id = $1",
    [tenantId],
  );

  return result.rows[0]?.data
    ? safeJson<BusinessProfile>(result.rows[0].data, null as never)
    : null;
}

async function getDashboard(db: DbClient, userId: string, tenantId: string) {
  await assertTenantAccess(db, userId, tenantId);
  const tenant = await getTenantById(db, tenantId);
  const website = await getWebsite(db, tenantId);
  const [leadRows, contactRows, taskRows, submissionRows] = await Promise.all([
    db.query<{ count: number }>("select count(*)::int as count from leads where tenant_id = $1", [
      tenantId,
    ]),
    db.query<{ count: number }>(
      "select count(*)::int as count from contacts where tenant_id = $1",
      [tenantId],
    ),
    db.query<{ count: number }>(
      "select count(*)::int as count from tasks where tenant_id = $1 and status = $2",
      [tenantId, "open"],
    ),
    db.query<{ count: number }>(
      "select count(*)::int as count from form_submissions where tenant_id = $1",
      [tenantId],
    ),
  ]);
  const stages = await db.query<{ stage: string; count: number }>(
    `select pipeline_stages.name as stage, count(opportunities.id)::int as count
     from pipeline_stages
     left join opportunities on opportunities.stage_id = pipeline_stages.id and opportunities.tenant_id = pipeline_stages.tenant_id
     where pipeline_stages.tenant_id = $1
     group by pipeline_stages.name, pipeline_stages.position
     order by pipeline_stages.position asc`,
    [tenantId],
  );
  const activities = await getTenantActivities(db, tenantId, 8);
  const workflowRuns = await getWorkflowRuns(db, userId, tenantId);
  const connectors = await getConnectors(db, userId, tenantId);
  const detectedOpportunities = (
    await getOpportunityRadar(db, userId, tenantId)
  ).filter((alert) => alert.status === "active");

  return {
    tenant,
    metrics: {
      newLeads: leadRows.rows[0]?.count ?? 0,
      contacts: contactRows.rows[0]?.count ?? 0,
      pendingTasks: taskRows.rows[0]?.count ?? 0,
      formSubmissions: submissionRows.rows[0]?.count ?? 0,
    },
    websiteStatus: website?.status === "published" ? "Publie" : "Brouillon",
    opportunitiesByStage: stages.rows,
    connectorHealth: connectors,
    recentActivities: activities,
    workflowRuns: workflowRuns.slice(0, 5),
    detectedOpportunities,
  } satisfies DashboardData;
}

async function getWorkflowRuns(db: DbClient, userId: string, tenantId: string) {
  await assertTenantAccess(db, userId, tenantId);
  const runs = await db.query<{
    id: string;
    tenant_id: string;
    workflow_key: string;
    trigger_name: string;
    status: "succeeded" | "failed" | "waiting";
    summary: string;
    created_at: string;
  }>("select * from workflow_runs where tenant_id = $1 order by created_at desc limit 20", [
    tenantId,
  ]);
  return runs.rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    workflowKey: row.workflow_key,
    triggerName: row.trigger_name,
    status: row.status,
    summary: row.summary,
    createdAt: row.created_at,
  })) satisfies WorkflowRun[];
}

async function getAuditLogs(db: DbClient, userId: string, tenantId: string) {
  await assertTenantAccess(db, userId, tenantId);
  const logs = await db.query<{
    id: string;
    tenant_id: string;
    actor_id: string;
    action: string;
    target_type: string;
    target_id: string;
    safe_metadata: string;
    correlation_id: string;
    created_at: string;
  }>("select * from audit_logs where tenant_id = $1 order by created_at desc limit 40", [
    tenantId,
  ]);

  return logs.rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: safeJson(row.safe_metadata, {}),
    correlationId: row.correlation_id,
    createdAt: row.created_at,
  })) satisfies AuditLog[];
}

async function seedDemo(db: DbClient) {
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
      { createDefaults: createTenantDefaults },
    );
  }

  const profile = await getOnboarding(db, user.id, tenant.id);
  if (!profile) {
    await saveOnboarding(db, user.id, tenant.id, defaultGarageOnboarding());
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

async function audit(
  db: DbClient,
  tenantId: string,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
) {
  await recordAuditLog(db, {
    tenantId,
    actorId,
    action,
    targetType,
    targetId,
    metadata,
  });
}
