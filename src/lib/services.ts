import { z } from "zod";
import { getDb, migrate, type DbClient } from "@/lib/db";
import {
  buildBusinessTwin,
  createWebsiteDraft,
  defaultGarageOnboarding,
} from "@/lib/generation";
import { executeLeadFollowUpWorkflow } from "@/modules/workflows/engine";
import { parseContactsCsv } from "@/modules/connectors/csv";
import {
  verifyWebhookEndpointSignature,
  type WebhookSignatureInput,
} from "@/modules/connectors/webhooks";
import {
  correlationId,
  daysFromNow,
  hashPassword,
  hashToken,
  id,
  nowIso,
  safeJson,
  secureToken,
  slugify,
  toJson,
  verifyPassword,
} from "@/lib/security";
import type {
  Activity,
  AuditLog,
  BusinessProfile,
  ConnectorCard,
  Contact,
  DashboardData,
  Lead,
  Membership,
  Role,
  Task,
  Tenant,
  User,
  Website,
  WebsiteSection,
  WebsiteTemplateKey,
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

const registrationSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});

const passwordResetSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8),
});

const invitationRoles = [
  "administrator",
  "manager",
  "collaborator",
  "read-only",
] as const;

const invitationSchema = z.object({
  email: z.string().email(),
  role: z.enum(invitationRoles),
});

const acceptInvitationSchema = z.object({
  token: z.string().min(20),
  name: z.string().min(2),
  password: z.string().min(8),
});

const updateMemberRoleSchema = z.object({
  targetUserId: z.string().min(1),
  role: z.enum(invitationRoles),
});

const orgSchema = z.object({
  name: z.string().min(2),
  category: z.string().min(2),
});

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

type SessionRow = {
  session_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  id: string;
  name: string;
  email: string;
  created_at: string;
};

type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
};

type InvitationRow = {
  id: string;
  tenant_id: string;
  email: string;
  role: Role;
  status: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
};

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  category: string;
  created_at: string;
};

type WebsiteRow = {
  id: string;
  tenant_id: string;
  name: string;
  template_key: WebsiteTemplateKey;
  theme: string;
  status: "draft" | "published";
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type WebsiteSectionRow = {
  id: string;
  tenant_id: string;
  website_id: string;
  type: WebsiteSection["type"];
  position: number;
  enabled: number;
  title: string;
  body: string;
  image_url: string | null;
  button_label: string | null;
  button_href: string | null;
  data: string;
};

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
      createTenant(db, userId, input),
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
    ) => submitPublicLead(db, slug, payload),
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

async function registerUser(db: DbClient, input: z.input<typeof registrationSchema>) {
  const parsed = registrationSchema.parse(input);
  const existing = await db.query("select id from users where email = $1", [
    parsed.email.toLowerCase(),
  ]);

  if (existing.rows.length > 0) {
    throw new Error("Un compte existe deja avec cet email.");
  }

  const userId = id("user");
  const createdAt = nowIso();
  await db.query(
    "insert into users (id, name, email, password_hash, created_at) values ($1, $2, $3, $4, $5)",
    [
      userId,
      parsed.name,
      parsed.email.toLowerCase(),
      hashPassword(parsed.password),
      createdAt,
    ],
  );

  return { id: userId, name: parsed.name, email: parsed.email, createdAt };
}

async function loginUser(db: DbClient, input: z.input<typeof loginSchema>) {
  const parsed = loginSchema.parse(input);
  const result = await db.query<UserRow>("select * from users where email = $1", [
    parsed.email.toLowerCase(),
  ]);
  const user = result.rows[0];

  if (!user || !verifyPassword(parsed.password, user.password_hash)) {
    throw new Error("Email ou mot de passe incorrect.");
  }

  return mapUser(user);
}

async function createSession(db: DbClient, userId: string) {
  const sessionId = id("sess");
  const sessionToken = secureToken();
  const expiresAt = daysFromNow(14);
  await db.query(
    "insert into sessions (id, user_id, token_hash, expires_at, revoked_at, created_at) values ($1, $2, $3, $4, $5, $6)",
    [sessionId, userId, hashToken(sessionToken), expiresAt, null, nowIso()],
  );
  return { sessionId, sessionToken, expiresAt };
}

async function getSessionUser(db: DbClient, sessionToken?: string) {
  if (!sessionToken) {
    return null;
  }

  const result = await db.query<SessionRow>(
    `select sessions.id as session_id, sessions.token_hash, sessions.expires_at, sessions.revoked_at, users.id, users.name, users.email, users.created_at
     from sessions
     join users on users.id = sessions.user_id
     where sessions.token_hash = $1 and sessions.expires_at > $2 and sessions.revoked_at is null`,
    [hashToken(sessionToken), nowIso()],
  );

  const row = result.rows[0];
  return row
    ? {
        sessionId: row.session_id,
        expiresAt: row.expires_at,
        user: mapUser(row),
      }
    : null;
}

async function revokeSession(db: DbClient, sessionToken?: string) {
  if (!sessionToken) {
    return;
  }

  await db.query("update sessions set revoked_at = $1 where token_hash = $2", [
    nowIso(),
    hashToken(sessionToken),
  ]);
}

async function requestPasswordReset(
  db: DbClient,
  input: z.input<typeof passwordResetRequestSchema>,
) {
  const parsed = passwordResetRequestSchema.parse(input);
  const email = parsed.email.toLowerCase();
  const user = await db.query<UserRow>("select * from users where email = $1", [
    email,
  ]);
  const existingUser = user.rows[0];

  if (!existingUser) {
    return { accepted: true };
  }

  const resetToken = secureToken();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await db.query(
    "update password_reset_tokens set used_at = $1 where user_id = $2 and used_at is null",
    [now, existingUser.id],
  );
  await db.query(
    "insert into password_reset_tokens (id, user_id, token_hash, expires_at, used_at) values ($1, $2, $3, $4, $5)",
    [id("reset"), existingUser.id, hashToken(resetToken), expiresAt, null],
  );

  return { accepted: true, resetToken, expiresAt, email };
}

async function resetPassword(
  db: DbClient,
  input: z.input<typeof passwordResetSchema>,
) {
  const parsed = passwordResetSchema.parse(input);
  const token = await db.query<{
    id: string;
    user_id: string;
    expires_at: string;
    used_at: string | null;
  }>(
    `select id, user_id, expires_at, used_at
     from password_reset_tokens
     where token_hash = $1 and used_at is null and expires_at > $2`,
    [hashToken(parsed.token), nowIso()],
  );
  const reset = token.rows[0];

  if (!reset) {
    throw new Error("Lien de réinitialisation invalide ou expiré.");
  }

  const now = nowIso();
  await db.query("update users set password_hash = $1 where id = $2", [
    hashPassword(parsed.password),
    reset.user_id,
  ]);
  await db.query(
    "update password_reset_tokens set used_at = $1 where user_id = $2 and used_at is null",
    [now, reset.user_id],
  );
  await db.query(
    "update sessions set revoked_at = $1 where user_id = $2 and revoked_at is null",
    [now, reset.user_id],
  );

  return { userId: reset.user_id };
}

async function createTenant(
  db: DbClient,
  userId: string,
  input: z.input<typeof orgSchema>,
) {
  const parsed = orgSchema.parse(input);
  const tenantId = id("tenant");
  const now = nowIso();
  const slug = await uniqueSlug(db, parsed.name);

  await db.query(
    "insert into tenants (id, name, slug, category, created_at) values ($1, $2, $3, $4, $5)",
    [tenantId, parsed.name, slug, parsed.category, now],
  );
  await db.query(
    "insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, $3, $4)",
    [tenantId, userId, "owner", now],
  );
  await createTenantDefaults(db, tenantId);
  await audit(db, tenantId, userId, "organization.created", "tenant", tenantId, {
    name: parsed.name,
  });

  return { id: tenantId, name: parsed.name, slug, category: parsed.category, createdAt: now };
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

async function getUserTenants(db: DbClient, userId: string) {
  const result = await db.query<TenantRow & { role: Role }>(
    `select tenants.*, memberships.role
     from tenants
     join memberships on memberships.tenant_id = tenants.id
     where memberships.user_id = $1
     order by tenants.created_at asc`,
    [userId],
  );

  return result.rows.map((row) => ({
    tenant: mapTenant(row),
    membership: {
      tenantId: row.id,
      userId,
      role: row.role,
    } satisfies Membership,
  }));
}

async function getTenantContext(
  db: DbClient,
  userId: string,
  preferredTenantId?: string,
) {
  const tenants = await getUserTenants(db, userId);
  if (tenants.length === 0) {
    return null;
  }

  return (
    tenants.find((item) => item.tenant.id === preferredTenantId) ?? tenants[0]
  );
}

async function getTenantMembers(db: DbClient, userId: string, tenantId: string) {
  await assertTenantAccess(db, userId, tenantId);
  const result = await db.query<{
    id: string;
    name: string;
    email: string;
    created_at: string;
    role: Role;
    membership_created_at: string;
  }>(
    `select users.id, users.name, users.email, users.created_at, memberships.role, memberships.created_at as membership_created_at
     from memberships
     join users on users.id = memberships.user_id
     where memberships.tenant_id = $1
     order by case when memberships.role = 'owner' then 0 when memberships.role = 'administrator' then 1 else 2 end, users.name asc`,
    [tenantId],
  );

  return result.rows.map((row) => ({
    user: mapUser(row),
    membership: {
      tenantId,
      userId: row.id,
      role: row.role,
    } satisfies Membership,
    joinedAt: row.membership_created_at,
  }));
}

async function getPendingInvitations(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId, ["owner", "administrator"]);
  const result = await db.query<InvitationRow>(
    `select *
     from invitations
     where tenant_id = $1 and status = $2 and expires_at > $3
     order by created_at desc`,
    [tenantId, "pending", nowIso()],
  );

  return result.rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

async function createInvitation(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: z.input<typeof invitationSchema>,
) {
  const actorRole = await assertTenantAccess(db, userId, tenantId, [
    "owner",
    "administrator",
  ]);
  const parsed = invitationSchema.parse(input);
  const email = parsed.email.toLowerCase();

  if (parsed.role === "administrator" && actorRole !== "owner") {
    throw new Error("Seul un propriétaire peut inviter un administrateur.");
  }

  const existingMember = await db.query(
    `select memberships.user_id
     from memberships
     join users on users.id = memberships.user_id
     where memberships.tenant_id = $1 and users.email = $2`,
    [tenantId, email],
  );

  if (existingMember.rows.length > 0) {
    throw new Error("Cet utilisateur est déjà membre de l'organisation.");
  }

  const now = nowIso();
  const invitationToken = secureToken();
  const invitationId = id("invite");
  const expiresAt = daysFromNow(7);

  await db.query(
    "update invitations set status = $1 where tenant_id = $2 and email = $3 and status = $4",
    ["revoked", tenantId, email, "pending"],
  );
  await db.query(
    "insert into invitations (id, tenant_id, email, role, status, token_hash, expires_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [
      invitationId,
      tenantId,
      email,
      parsed.role,
      "pending",
      hashToken(invitationToken),
      expiresAt,
      now,
    ],
  );
  await audit(db, tenantId, userId, "team.invitation_created", "invitation", invitationId, {
    email,
    role: parsed.role,
  });

  return {
    id: invitationId,
    email,
    role: parsed.role,
    invitationToken,
    expiresAt,
  };
}

async function acceptInvitation(
  db: DbClient,
  input: z.input<typeof acceptInvitationSchema>,
) {
  const parsed = acceptInvitationSchema.parse(input);
  const invitation = await findPendingInvitation(db, parsed.token);

  if (!invitation) {
    throw new Error("Invitation invalide ou expirée.");
  }

  const existingUser = await db.query<UserRow>("select * from users where email = $1", [
    invitation.email,
  ]);

  if (existingUser.rows[0]) {
    throw new Error(
      "Ce compte existe déjà. Connectez-vous puis ouvrez à nouveau le lien d'invitation.",
    );
  }

  const user = await registerUser(db, {
    name: parsed.name,
    email: invitation.email,
    password: parsed.password,
  });
  const membership = await completeInvitation(db, invitation, user.id);
  const tenant = await getTenantById(db, invitation.tenant_id);

  return { user, tenant, membership };
}

async function acceptInvitationForUser(
  db: DbClient,
  userId: string,
  token: string,
) {
  const invitation = await findPendingInvitation(db, token);

  if (!invitation) {
    throw new Error("Invitation invalide ou expirée.");
  }

  const user = await db.query<UserRow>("select * from users where id = $1", [userId]);
  const existingUser = user.rows[0];

  if (!existingUser || existingUser.email !== invitation.email) {
    throw new Error("Cette invitation ne correspond pas au compte connecté.");
  }

  const membership = await completeInvitation(db, invitation, userId);
  const tenant = await getTenantById(db, invitation.tenant_id);

  return { user: mapUser(existingUser), tenant, membership };
}

async function updateMemberRole(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: z.input<typeof updateMemberRoleSchema>,
) {
  const actorRole = await assertTenantAccess(db, userId, tenantId, [
    "owner",
    "administrator",
  ]);
  const parsed = updateMemberRoleSchema.parse(input);

  if (parsed.targetUserId === userId) {
    throw new Error("Votre propre rôle ne peut pas être modifié ici.");
  }

  const target = await db.query<{ role: Role }>(
    "select role from memberships where tenant_id = $1 and user_id = $2",
    [tenantId, parsed.targetUserId],
  );
  const currentRole = target.rows[0]?.role;

  if (!currentRole) {
    throw new Error("Membre introuvable.");
  }

  if (currentRole === "owner") {
    throw new Error("Le rôle propriétaire ne peut pas être modifié.");
  }

  if (
    actorRole !== "owner" &&
    (currentRole === "administrator" || parsed.role === "administrator")
  ) {
    throw new Error("Seul un propriétaire peut gérer les administrateurs.");
  }

  await db.query(
    "update memberships set role = $1 where tenant_id = $2 and user_id = $3",
    [parsed.role, tenantId, parsed.targetUserId],
  );
  await audit(db, tenantId, userId, "team.member_role_updated", "membership", parsed.targetUserId, {
    previousRole: currentRole,
    role: parsed.role,
  });

  return {
    tenantId,
    userId: parsed.targetUserId,
    role: parsed.role,
  } satisfies Membership;
}

async function assertTenantAccess(
  db: DbClient,
  userId: string,
  tenantId: string,
  allowedRoles: Role[] = [
    "owner",
    "administrator",
    "manager",
    "collaborator",
    "read-only",
  ],
) {
  const result = await db.query<{ role: Role }>(
    "select role from memberships where user_id = $1 and tenant_id = $2",
    [userId, tenantId],
  );
  const role = result.rows[0]?.role;

  if (!role || !allowedRoles.includes(role)) {
    throw new Error("Acces refuse pour cette organisation.");
  }

  return role;
}

async function findPendingInvitation(db: DbClient, token: string) {
  if (!token) {
    return null;
  }

  const result = await db.query<InvitationRow>(
    `select *
     from invitations
     where token_hash = $1 and status = $2 and expires_at > $3`,
    [hashToken(token), "pending", nowIso()],
  );

  return result.rows[0] ?? null;
}

async function completeInvitation(
  db: DbClient,
  invitation: InvitationRow,
  userId: string,
) {
  const now = nowIso();
  const existing = await db.query<{ role: Role }>(
    "select role from memberships where tenant_id = $1 and user_id = $2",
    [invitation.tenant_id, userId],
  );

  if (!existing.rows[0]) {
    await db.query(
      "insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, $3, $4)",
      [invitation.tenant_id, userId, invitation.role, now],
    );
  }

  await db.query("update invitations set status = $1 where id = $2", [
    "accepted",
    invitation.id,
  ]);
  await audit(
    db,
    invitation.tenant_id,
    userId,
    "team.invitation_accepted",
    "invitation",
    invitation.id,
    { email: invitation.email, role: invitation.role },
  );

  return {
    tenantId: invitation.tenant_id,
    userId,
    role: existing.rows[0]?.role ?? invitation.role,
  } satisfies Membership;
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

async function generateOrReplaceWebsite(
  db: DbClient,
  tenantId: string,
  profile: BusinessProfile,
) {
  const existing = await db.query<{ id: string }>(
    "select id from websites where tenant_id = $1 limit 1",
    [tenantId],
  );
  const draft = createWebsiteDraft(tenantId, profile);

  if (existing.rows[0]) {
    const websiteId = existing.rows[0].id;
    await db.query("delete from website_sections where tenant_id = $1 and website_id = $2", [
      tenantId,
      websiteId,
    ]);
    await db.query(
      "update websites set name = $1, template_key = $2, theme = $3, status = $4, updated_at = $5 where tenant_id = $6 and id = $7",
      [
        draft.website.name,
        draft.website.templateKey,
        toJson(draft.website.theme),
        "draft",
        nowIso(),
        tenantId,
        websiteId,
      ],
    );

    for (const section of draft.sections) {
      await insertSection(db, { ...section, websiteId });
    }

    await snapshotWebsite(db, tenantId, websiteId, "deterministic_regeneration");
    return;
  }

  await insertWebsite(db, draft.website);
  await db.query(
    "insert into website_pages (id, tenant_id, website_id, slug, title, seo_metadata, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [
      id("page"),
      tenantId,
      draft.website.id,
      "accueil",
      draft.website.name,
      toJson({
        title: draft.website.name,
        description: profile.identity.description,
      }),
      nowIso(),
    ],
  );
  await db.query(
    "insert into forms (id, tenant_id, website_id, name, created_at) values ($1, $2, $3, $4, $5)",
    [id("form"), tenantId, draft.website.id, "Formulaire contact site", nowIso()],
  );

  for (const section of draft.sections) {
    await insertSection(db, section);
  }

  await snapshotWebsite(db, tenantId, draft.website.id, "deterministic_generation");
}

async function getWebsiteWorkspace(db: DbClient, userId: string, tenantId: string) {
  await assertTenantAccess(db, userId, tenantId);
  const website = await getWebsite(db, tenantId);
  const profile = await getOnboarding(db, userId, tenantId);
  const sections = website ? await getWebsiteSections(db, tenantId, website.id) : [];
  const versions = website
    ? await db.query<{ id: string; source: string; approval_state: string; created_at: string }>(
        "select id, source, approval_state, created_at from website_versions where tenant_id = $1 and website_id = $2 order by created_at desc limit 8",
        [tenantId, website.id],
      )
    : { rows: [] };

  return { profile, website, sections, versions: versions.rows };
}

async function updateWebsiteSection(
  db: DbClient,
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
) {
  await assertTenantAccess(db, userId, tenantId, [
    "owner",
    "administrator",
    "manager",
    "collaborator",
  ]);
  const row = await db.query<{ website_id: string }>(
    "select website_id from website_sections where tenant_id = $1 and id = $2",
    [tenantId, sectionId],
  );
  const websiteId = row.rows[0]?.website_id;
  if (!websiteId) {
    throw new Error("Section introuvable.");
  }

  await db.query(
    `update website_sections
     set title = $1, body = $2, image_url = $3, button_label = $4, button_href = $5, enabled = $6
     where tenant_id = $7 and id = $8`,
    [
      input.title,
      input.body,
      input.imageUrl || null,
      input.buttonLabel || null,
      input.buttonHref || null,
      input.enabled ? 1 : 0,
      tenantId,
      sectionId,
    ],
  );
  await db.query(
    "update websites set status = $1, updated_at = $2 where tenant_id = $3 and id = $4",
    ["draft", nowIso(), tenantId, websiteId],
  );
  await snapshotWebsite(db, tenantId, websiteId, "manual_edit");
  await audit(db, tenantId, userId, "website.section_updated", "website_section", sectionId, {
    enabled: input.enabled,
  });
}

async function moveWebsiteSection(
  db: DbClient,
  userId: string,
  tenantId: string,
  sectionId: string,
  direction: "up" | "down",
) {
  await assertTenantAccess(db, userId, tenantId, [
    "owner",
    "administrator",
    "manager",
    "collaborator",
  ]);
  const sections = await db.query<{ id: string; website_id: string; position: number }>(
    "select id, website_id, position from website_sections where tenant_id = $1 order by position asc",
    [tenantId],
  );
  const index = sections.rows.findIndex((section) => section.id === sectionId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  const current = sections.rows[index];
  const target = sections.rows[targetIndex];

  if (!current || !target) {
    return;
  }

  await db.query("update website_sections set position = $1 where tenant_id = $2 and id = $3", [
    target.position,
    tenantId,
    current.id,
  ]);
  await db.query("update website_sections set position = $1 where tenant_id = $2 and id = $3", [
    current.position,
    tenantId,
    target.id,
  ]);
  await db.query(
    "update websites set status = $1, updated_at = $2 where tenant_id = $3 and id = $4",
    ["draft", nowIso(), tenantId, current.website_id],
  );
  await snapshotWebsite(db, tenantId, current.website_id, "manual_reorder");
  await audit(db, tenantId, userId, "website.section_reordered", "website_section", sectionId, {
    direction,
  });
}

async function publishWebsite(db: DbClient, userId: string, tenantId: string) {
  await assertTenantAccess(db, userId, tenantId, ["owner", "administrator", "manager"]);
  const website = await getWebsite(db, tenantId);
  if (!website) {
    throw new Error("Aucun site a publier.");
  }

  const versionId = await snapshotWebsite(
    db,
    tenantId,
    website.id,
    "publication",
    "published",
  );
  const tenant = await getTenantById(db, tenantId);
  const now = nowIso();
  const localUrl = `/sites/${tenant.slug}`;

  await db.query(
    "update websites set status = $1, published_at = $2, current_version_id = $3, current_published_version_id = $4, updated_at = $5 where tenant_id = $6 and id = $7",
    ["published", now, versionId, versionId, now, tenantId, website.id],
  );
  await db.query(
    "insert into website_publications (id, tenant_id, website_id, version_id, local_url, published_at) values ($1, $2, $3, $4, $5, $6)",
    [id("publication"), tenantId, website.id, versionId, localUrl, now],
  );
  await audit(db, tenantId, userId, "website.published", "website", website.id, {
    localUrl,
  });

  return localUrl;
}

async function restoreWebsiteVersion(
  db: DbClient,
  userId: string,
  tenantId: string,
  versionId: string,
) {
  await assertTenantAccess(db, userId, tenantId, ["owner", "administrator", "manager"]);
  const result = await db.query<{ website_id: string; snapshot: string }>(
    "select website_id, snapshot from website_versions where tenant_id = $1 and id = $2",
    [tenantId, versionId],
  );
  const version = result.rows[0];
  if (!version) {
    throw new Error("Version introuvable.");
  }

  const snapshot = safeJson<{ sections: WebsiteSection[] }>(version.snapshot, {
    sections: [],
  });
  await db.query("delete from website_sections where tenant_id = $1 and website_id = $2", [
    tenantId,
    version.website_id,
  ]);

  for (const section of snapshot.sections) {
    await insertSection(db, {
      ...section,
      id: id("section"),
      tenantId,
      websiteId: version.website_id,
    });
  }

  await db.query(
    "update websites set status = $1, updated_at = $2 where tenant_id = $3 and id = $4",
    ["draft", nowIso(), tenantId, version.website_id],
  );
  await audit(db, tenantId, userId, "website.version_restored", "website_version", versionId, {});
}

async function getPublishedSite(db: DbClient, slug: string) {
  const tenant = await getTenantBySlug(db, slug);
  if (!tenant) {
    return null;
  }

  const publication = await db.query<{ snapshot: string }>(
    `select website_versions.snapshot
     from website_publications
     join website_versions on website_versions.id = website_publications.version_id
     where website_publications.tenant_id = $1
     order by website_publications.published_at desc
     limit 1`,
    [tenant.id],
  );
  const snapshot = publication.rows[0]?.snapshot;

  if (!snapshot) {
    return null;
  }

  const published = safeJson<{ website: Website; sections: WebsiteSection[] }>(
    snapshot,
    null as never,
  );

  if (!published?.website || published.website.status === "draft") {
    published.website.status = "published";
  }

  return {
    tenant,
    website: published.website,
    sections: published.sections.filter((section) => section.enabled),
  };
}

async function submitPublicLead(
  db: DbClient,
  slug: string,
  payload: {
    name: string;
    email: string;
    phone: string;
    message: string;
    idempotencyKey?: string;
  },
) {
  const site = await getPublishedSite(db, slug);
  if (!site) {
    throw new Error("Site introuvable ou non publie.");
  }

  const websiteId = site.website.id;
  const tenantId = site.tenant.id;
  const idempotencyKey = payload.idempotencyKey || secureToken();
  const existing = await db.query<{ id: string }>(
    "select id from form_submissions where tenant_id = $1 and idempotency_key = $2",
    [tenantId, idempotencyKey],
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const result = await createLeadFromPayload(db, tenantId, {
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    message: payload.message,
    source: "website",
    pagePath: `/sites/${slug}`,
    websiteId,
  });

  await db.query(
    `insert into form_submissions (id, tenant_id, form_id, website_id, payload, created_contact_id, idempotency_key, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id("submission"),
      tenantId,
      null,
      websiteId,
      toJson(payload),
      result.contactId,
      idempotencyKey,
      nowIso(),
    ],
  );
  await audit(db, tenantId, "system", "form.submitted", "website", websiteId, {
    source: "website",
  });

  return result.leadId;
}

async function createLeadFromPayload(
  db: DbClient,
  tenantId: string,
  payload: {
    name: string;
    email: string;
    phone: string;
    message?: string;
    source: string;
    pagePath: string;
    websiteId?: string;
  },
) {
  const now = nowIso();
  const normalizedEmail = payload.email.toLowerCase();
  const ownerId = await getTenantOwnerId(db, tenantId);
  let contactId: string;
  const existing = await db.query<{ id: string }>(
    "select id from contacts where tenant_id = $1 and email = $2",
    [tenantId, normalizedEmail],
  );

  if (existing.rows[0]) {
    contactId = existing.rows[0].id;
    await db.query(
      "update contacts set name = $1, phone = $2, status = $3, source = $4, updated_at = $5 where tenant_id = $6 and id = $7",
      [payload.name, payload.phone, "A qualifier", payload.source, now, tenantId, contactId],
    );
  } else {
    contactId = id("contact");
    await db.query(
      `insert into contacts (id, tenant_id, name, email, phone, status, source, tags, assigned_user_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        contactId,
        tenantId,
        payload.name,
        normalizedEmail,
        payload.phone,
        "Nouveau",
        payload.source,
        toJson([payload.source]),
        ownerId,
        now,
        now,
      ],
    );
    await audit(db, tenantId, "system", "contact.created", "contact", contactId, {
      source: payload.source,
    });
  }

  const leadId = id("lead");
  await db.query(
    `insert into leads (id, tenant_id, contact_id, source, status, opportunity_value, page_path, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [leadId, tenantId, contactId, payload.source, "Nouveau contact", 0, payload.pagePath, now],
  );

  const stage = await db.query<{ id: string }>(
    "select id from pipeline_stages where tenant_id = $1 order by position asc limit 1",
    [tenantId],
  );
  if (stage.rows[0]) {
    await db.query(
      `insert into opportunities (id, tenant_id, contact_id, stage_id, value_cents, next_follow_up_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id("opp"), tenantId, contactId, stage.rows[0].id, 0, daysFromNow(1), now, now],
    );
  }

  await db.query(
    "insert into activities (id, tenant_id, type, summary, target_type, target_id, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [
      id("activity"),
      tenantId,
      "lead.created",
      `Nouveau lead recu depuis ${payload.source}`,
      "lead",
      leadId,
      now,
    ],
  );
  await audit(db, tenantId, "system", "lead.created", "lead", leadId, {
    source: payload.source,
  });
  await runDefaultLeadWorkflow(db, tenantId, leadId, contactId, ownerId, payload.source);

  return { leadId, contactId };
}

async function runDefaultLeadWorkflow(
  db: DbClient,
  tenantId: string,
  leadId: string,
  contactId: string,
  ownerId: string,
  source: string,
) {
  const runId = await executeLeadFollowUpWorkflow(db, {
    tenantId,
    leadId,
    contactId,
    ownerId,
    source,
    correlationId: correlationId(),
  });

  if (runId) {
    await audit(db, tenantId, "system", "workflow.executed", "workflow_run", runId, {
      leadId,
    });
  }
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
    tenant = await createTenant(db, user.id, {
      name: "Garage Caraibes Auto",
      category: "Garage automobile",
    });
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
    await submitPublicLead(db, tenant.slug, {
      name: "Jonathan Pelage",
      email: "jonathan.pelage@example.com",
      phone: "+596 696 11 22 33",
      message: "Bonjour, je souhaite un devis pour un diagnostic climatisation.",
    });
  }

  return { user, tenant, password: "Tradikom!2026" };
}

async function insertWebsite(db: DbClient, website: Website) {
  await db.query(
    `insert into websites (id, tenant_id, name, template_key, theme, status, current_version_id, published_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      website.id,
      website.tenantId,
      website.name,
      website.templateKey,
      toJson(website.theme),
      website.status,
      null,
      website.publishedAt ?? null,
      website.createdAt,
      website.updatedAt,
    ],
  );
}

async function insertSection(db: DbClient, section: WebsiteSection) {
  await db.query(
    `insert into website_sections (id, tenant_id, website_id, type, position, enabled, title, body, image_url, button_label, button_href, data)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      section.id,
      section.tenantId,
      section.websiteId,
      section.type,
      section.position,
      section.enabled ? 1 : 0,
      section.title,
      section.body,
      section.imageUrl ?? null,
      section.buttonLabel ?? null,
      section.buttonHref ?? null,
      toJson(section.data),
    ],
  );
}

async function snapshotWebsite(
  db: DbClient,
  tenantId: string,
  websiteId: string,
  source: string,
  versionType: "draft" | "published" = "draft",
) {
  const website = await getWebsite(db, tenantId);
  const sections = await getWebsiteSections(db, tenantId, websiteId);
  const versionId = id("version");
  await db.query(
    "insert into website_versions (id, tenant_id, website_id, snapshot, approval_state, source, version_type, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [
      versionId,
      tenantId,
      websiteId,
      toJson({ website, sections }),
      "approved_for_preview",
      source,
      versionType,
      nowIso(),
    ],
  );
  await db.query(
    "update websites set current_version_id = $1, current_draft_version_id = case when $2 = 'draft' then $1 else current_draft_version_id end where tenant_id = $3 and id = $4",
    [versionId, versionType, tenantId, websiteId],
  );
  return versionId;
}

async function getWebsite(db: DbClient, tenantId: string) {
  const result = await db.query<WebsiteRow>(
    "select * from websites where tenant_id = $1 order by created_at desc limit 1",
    [tenantId],
  );
  const row = result.rows[0];
  return row ? mapWebsite(row) : null;
}

async function getWebsiteSections(db: DbClient, tenantId: string, websiteId: string) {
  const result = await db.query<WebsiteSectionRow>(
    "select * from website_sections where tenant_id = $1 and website_id = $2 order by position asc",
    [tenantId, websiteId],
  );

  return result.rows.map(mapSection);
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

async function getTenantById(db: DbClient, tenantId: string) {
  const result = await db.query<TenantRow>("select * from tenants where id = $1", [tenantId]);
  const tenant = result.rows[0];
  if (!tenant) {
    throw new Error("Organisation introuvable.");
  }
  return mapTenant(tenant);
}

async function getTenantBySlug(db: DbClient, slug: string) {
  const result = await db.query<TenantRow>("select * from tenants where slug = $1", [slug]);
  return result.rows[0] ? mapTenant(result.rows[0]) : null;
}

async function getTenantOwnerId(db: DbClient, tenantId: string) {
  const owner = await db.query<{ user_id: string }>(
    "select user_id from memberships where tenant_id = $1 order by case when role = 'owner' then 0 else 1 end limit 1",
    [tenantId],
  );
  const ownerId = owner.rows[0]?.user_id;
  if (!ownerId) {
    throw new Error("Aucun proprietaire trouve pour cette organisation.");
  }
  return ownerId;
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
  await db.query(
    "insert into audit_logs (id, tenant_id, actor_id, action, target_type, target_id, safe_metadata, correlation_id, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      id("audit"),
      tenantId,
      actorId,
      action,
      targetType,
      targetId,
      toJson(metadata),
      correlationId(),
      nowIso(),
    ],
  );
}

async function uniqueSlug(db: DbClient, value: string) {
  const base = slugify(value) || "organisation";
  let candidate = base;
  let suffix = 1;

  while (true) {
    const exists = await db.query("select id from tenants where slug = $1", [candidate]);
    if (exists.rows.length === 0) {
      return candidate;
    }
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

function mapUser(row: Pick<UserRow, "id" | "name" | "email" | "created_at">): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
  };
}

function mapTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    createdAt: row.created_at,
  };
}

function mapWebsite(row: WebsiteRow): Website {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    templateKey: row.template_key,
    status: row.status,
    theme: safeJson(row.theme, {
      primary: "#08111f",
      accent: "#19c6b7",
      background: "#fffaf1",
      text: "#111827",
      radius: "8px",
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at ?? undefined,
  };
}

function mapSection(row: WebsiteSectionRow): WebsiteSection {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    websiteId: row.website_id,
    type: row.type,
    position: Number(row.position),
    enabled: Boolean(row.enabled),
    title: row.title,
    body: row.body,
    imageUrl: row.image_url ?? undefined,
    buttonLabel: row.button_label ?? undefined,
    buttonHref: row.button_href ?? undefined,
    data: safeJson(row.data, {}),
  };
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
