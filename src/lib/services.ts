import { z } from "zod";
import { getDb, migrate, type DbClient } from "@/lib/db";
import {
  buildBusinessTwin,
  defaultGarageOnboarding,
} from "@/lib/generation";
import { parseContactsCsv } from "@/modules/connectors/csv";
import {
  verifyWebhookEndpointSignature,
  type WebhookSignatureInput,
} from "@/modules/connectors/webhooks";
import {
  createLeadFromPayload,
  submitPublicLead as submitPublicLeadDomain,
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
  id,
  nowIso,
  safeJson,
  toJson,
} from "@/lib/security";
import type {
  Activity,
  AuditLog,
  BusinessProfile,
  ConnectorCard,
  Contact,
  DashboardData,
  Lead,
  Task,
  User,
  Website,
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

const connectorMetadata: ConnectorCard[] = [
  {
    key: "generic_webhook",
    name: "Webhook generique",
    description: "Recevez des demandes JSON depuis n'importe quel outil.",
    status: "Connecté",
    health: "healthy",
    capabilities: ["webhook", "mapping contact", "journal livraisons"],
  },
  {
    key: "csv_contacts",
    name: "Import CSV contacts",
    description: "Importez un fichier de contacts et detectez les doublons.",
    status: "Disponible",
    health: "inactive",
    capabilities: ["csv", "validation", "rapport import"],
  },
  {
    key: "mock_business",
    name: "Logiciel metier demo",
    description: "Simule clients, rendez-vous, devis et factures.",
    status: "Configuration requise",
    health: "warning",
    capabilities: ["sync", "clients", "rendez-vous", "devis"],
  },
  {
    key: "google_business_profile",
    name: "Google Business Profile",
    description: "Connexion prevue apres validation OAuth.",
    status: "Bientôt disponible",
    health: "inactive",
    capabilities: ["avis", "profil", "statistiques"],
  },
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
    getCrm: (userId: string, tenantId: string) => getCrm(db, userId, tenantId),
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

  for (const connector of connectorMetadata.slice(0, 3)) {
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
  const activities = await getActivities(db, tenantId, 8);
  const workflowRuns = await getWorkflowRuns(db, userId, tenantId);
  const connectors = await getConnectors(db, userId, tenantId);
  const detectedOpportunities = await detectOpportunities(db, tenantId, website);

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

async function getCrm(db: DbClient, userId: string, tenantId: string) {
  await assertTenantAccess(db, userId, tenantId);
  const contacts = await db.query<{
    id: string;
    tenant_id: string;
    name: string;
    email: string;
    phone: string;
    status: string;
    source: string;
    tags: string;
    assigned_user_id: string | null;
    created_at: string;
    updated_at: string;
  }>("select * from contacts where tenant_id = $1 order by updated_at desc", [tenantId]);
  const leads = await db.query<{
    id: string;
    tenant_id: string;
    contact_id: string;
    source: string;
    status: string;
    opportunity_value: number;
    page_path: string;
    created_at: string;
  }>("select * from leads where tenant_id = $1 order by created_at desc", [tenantId]);
  const tasks = await db.query<{
    id: string;
    tenant_id: string;
    title: string;
    status: "open" | "done";
    assigned_user_id: string;
    due_at: string;
    related_type: string;
    related_id: string;
    created_at: string;
  }>("select * from tasks where tenant_id = $1 order by created_at desc", [tenantId]);
  const activities = await getActivities(db, tenantId, 20);

  return {
    contacts: contacts.rows.map(mapContact),
    leads: leads.rows.map(mapLead),
    tasks: tasks.rows.map(mapTask),
    activities,
  };
}

async function getConnectors(db: DbClient, userId: string, tenantId: string) {
  await assertTenantAccess(db, userId, tenantId);
  const rows = await db.query<{
    connector_key: string;
    status: ConnectorCard["status"];
    health: ConnectorCard["health"];
    last_sync_at: string | null;
  }>("select connector_key, status, health, last_sync_at from connectors where tenant_id = $1", [
    tenantId,
  ]);
  const byKey = new Map(rows.rows.map((row) => [row.connector_key, row]));

  return connectorMetadata.map((connector) => {
    const state = byKey.get(connector.key);
    return state
      ? {
          ...connector,
          status: state.status,
          health: state.health,
          lastSyncAt: state.last_sync_at ?? undefined,
        }
      : connector;
  });
}

async function importCsvContacts(
  db: DbClient,
  userId: string,
  tenantId: string,
  csvText: string,
) {
  await assertTenantAccess(db, userId, tenantId, ["owner", "administrator", "manager"]);
  const rows = parseContactsCsv(csvText);
  const importId = id("import");
  const report = {
    total: rows.length,
    imported: 0,
    duplicates: 0,
    invalid: 0,
  };
  const now = nowIso();

  await db.query(
    "insert into imports (id, tenant_id, source, status, report, created_at) values ($1, $2, $3, $4, $5, $6)",
    [importId, tenantId, "csv_contacts", "running", toJson(report), now],
  );

  for (const [index, row] of rows.entries()) {
    const name = row.name;
    const email = row.email;
    const phone = row.phone;

    if (!name || !email.includes("@")) {
      report.invalid += 1;
      await insertImportRow(db, tenantId, importId, index + 2, "invalid", row.raw, "Email invalide");
      continue;
    }

    const duplicate = await db.query<{ id: string }>(
      "select id from contacts where tenant_id = $1 and email = $2",
      [tenantId, email],
    );
    if (duplicate.rows[0]) {
      report.duplicates += 1;
      await insertImportRow(db, tenantId, importId, index + 2, "duplicate", row.raw, null);
      continue;
    }

    await db.query(
      `insert into contacts (id, tenant_id, name, email, phone, status, source, tags, assigned_user_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id("contact"),
        tenantId,
        name,
        email,
        phone,
        "Importe",
        "csv",
        toJson(["csv"]),
        userId,
        nowIso(),
        nowIso(),
      ],
    );
    report.imported += 1;
    await insertImportRow(db, tenantId, importId, index + 2, "imported", row.raw, null);
  }

  await db.query("update imports set status = $1, report = $2 where tenant_id = $3 and id = $4", [
    "completed",
    toJson(report),
    tenantId,
    importId,
  ]);
  await audit(db, tenantId, userId, "connector.csv_imported", "import", importId, report);

  return report;
}

async function syncMockConnector(db: DbClient, userId: string, tenantId: string) {
  await assertTenantAccess(db, userId, tenantId, ["owner", "administrator", "manager"]);
  const now = nowIso();
  await db.query(
    "update connectors set status = $1, health = $2, last_sync_at = $3, updated_at = $4 where tenant_id = $5 and connector_key = $6",
    ["Connecté", "healthy", now, now, tenantId, "mock_business"],
  );
  await db.query(
    "insert into connector_sync_runs (id, tenant_id, connector_key, status, summary, created_at) values ($1, $2, $3, $4, $5, $6)",
    [
      id("sync"),
      tenantId,
      "mock_business",
      "succeeded",
      "3 clients, 2 rendez-vous et 1 devis simules synchronises.",
      now,
    ],
  );
  await db.query(
    "insert into activities (id, tenant_id, type, summary, target_type, target_id, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [
      id("activity"),
      tenantId,
      "connector.sync_completed",
      "Synchronisation demo terminee.",
      "connector",
      "mock_business",
      now,
    ],
  );
  await audit(db, tenantId, userId, "connector.sync_completed", "connector", "mock_business", {});
}

async function receiveWebhook(
  db: DbClient,
  token: string,
  payload: Record<string, unknown>,
  signatureInput?: WebhookSignatureInput,
) {
  const endpoint = await db.query<{
    id: string;
    tenant_id: string;
    secret_hash: string | null;
    status: string;
  }>("select * from webhook_endpoints where token = $1", [token]);
  const row = endpoint.rows[0];
  if (!row || row.status !== "active") {
    throw new Error("Webhook invalide.");
  }

  const signature = await verifyWebhookEndpointSignature(
    db,
    {
      id: row.id,
      tenantId: row.tenant_id,
      secretHash: row.secret_hash,
    },
    signatureInput,
  );

  if (!signature.ok) {
    await recordWebhookDelivery(
      db,
      row.tenant_id,
      row.id,
      payload,
      "rejected",
      signature.error,
    );
    throw new Error(signature.error);
  }

  const mapped = {
    name: String(payload.name ?? payload.nom ?? "Contact webhook"),
    email: String(payload.email ?? payload.mail ?? ""),
    phone: String(payload.phone ?? payload.telephone ?? ""),
    message: String(payload.message ?? payload.notes ?? "Demande recue par webhook"),
  };

  if (!mapped.email.includes("@")) {
    await recordWebhookDelivery(db, row.tenant_id, row.id, payload, "rejected", "Email invalide");
    throw new Error("Payload invalide.");
  }

  const result = await createLeadFromPayload(db, row.tenant_id, {
    ...mapped,
    source: "webhook",
    pagePath: "webhook/generic",
  });
  await recordWebhookDelivery(db, row.tenant_id, row.id, payload, "accepted", null);
  await audit(db, row.tenant_id, "system", "connector.webhook_received", "lead", result.leadId, {
    endpointId: row.id,
  });

  return result;
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

async function findContactForTenant(
  db: DbClient,
  userId: string,
  tenantId: string,
  contactId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const contact = await db.query<{
    id: string;
    tenant_id: string;
    name: string;
    email: string;
    phone: string;
    status: string;
    source: string;
    tags: string;
    assigned_user_id: string | null;
    created_at: string;
    updated_at: string;
  }>("select * from contacts where tenant_id = $1 and id = $2", [tenantId, contactId]);

  return contact.rows[0] ? mapContact(contact.rows[0]) : null;
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

async function getActivities(db: DbClient, tenantId: string, limit: number) {
  const rows = await db.query<{
    id: string;
    tenant_id: string;
    type: string;
    summary: string;
    target_type: string;
    target_id: string;
    created_at: string;
  }>(
    `select * from activities where tenant_id = $1 order by created_at desc limit ${Number(
      limit,
    )}`,
    [tenantId],
  );
  return rows.rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    summary: row.summary,
    targetType: row.target_type,
    targetId: row.target_id,
    createdAt: row.created_at,
  })) satisfies Activity[];
}

async function detectOpportunities(
  db: DbClient,
  tenantId: string,
  website: Website | null,
) {
  const opportunities: string[] = [];
  const pendingTasks = await db.query<{ count: number }>(
    "select count(*)::int as count from tasks where tenant_id = $1 and status = $2 and due_at < $3",
    [tenantId, "open", nowIso()],
  );
  const unassigned = await db.query<{ count: number }>(
    "select count(*)::int as count from contacts where tenant_id = $1 and assigned_user_id is null",
    [tenantId],
  );
  const connectorErrors = await db.query<{ count: number }>(
    "select count(*)::int as count from connectors where tenant_id = $1 and health = $2",
    [tenantId, "error"],
  );

  if (!website || website.status !== "published") {
    opportunities.push("Le site est encore en brouillon : publier pour capter des demandes.");
  }
  if ((pendingTasks.rows[0]?.count ?? 0) > 0) {
    opportunities.push("Des relances depassent 24h : prioriser les leads chauds.");
  }
  if ((unassigned.rows[0]?.count ?? 0) > 0) {
    opportunities.push("Des contacts n'ont pas de responsable assigne.");
  }
  if ((connectorErrors.rows[0]?.count ?? 0) > 0) {
    opportunities.push("Une connexion est en erreur et peut masquer des opportunites.");
  }

  return opportunities.length > 0
    ? opportunities
    : ["Aucune alerte critique. Continuer le suivi des nouveaux leads."];
}

async function recordWebhookDelivery(
  db: DbClient,
  tenantId: string,
  endpointId: string,
  payload: Record<string, unknown>,
  status: string,
  error: string | null,
) {
  await db.query(
    "insert into webhook_deliveries (id, tenant_id, webhook_endpoint_id, status, payload, error, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [id("delivery"), tenantId, endpointId, status, toJson(payload), error, nowIso()],
  );
}

async function insertImportRow(
  db: DbClient,
  tenantId: string,
  importId: string,
  rowNumber: number,
  status: string,
  data: Record<string, string>,
  error: string | null,
) {
  await db.query(
    "insert into import_rows (id, tenant_id, import_id, row_number, status, safe_data, error) values ($1, $2, $3, $4, $5, $6, $7)",
    [id("importrow"), tenantId, importId, rowNumber, status, toJson(data), error],
  );
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

function mapContact(row: {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  source: string;
  tags: string;
  assigned_user_id: string | null;
  created_at: string;
  updated_at: string;
}): Contact {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    source: row.source,
    tags: safeJson<string[]>(row.tags, []),
    assignedUserId: row.assigned_user_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLead(row: {
  id: string;
  tenant_id: string;
  contact_id: string;
  source: string;
  status: string;
  opportunity_value: number;
  page_path: string;
  created_at: string;
}): Lead {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    source: row.source,
    status: row.status,
    opportunityValue: row.opportunity_value,
    pagePath: row.page_path,
    createdAt: row.created_at,
  };
}

function mapTask(row: {
  id: string;
  tenant_id: string;
  title: string;
  status: "open" | "done";
  assigned_user_id: string;
  due_at: string;
  related_type: string;
  related_id: string;
  created_at: string;
}): Task {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    status: row.status,
    assignedUserId: row.assigned_user_id,
    dueAt: row.due_at,
    relatedType: row.related_type,
    relatedId: row.related_id,
    createdAt: row.created_at,
  };
}
