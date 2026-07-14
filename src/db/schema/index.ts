import {
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  platformRole: text("platform_role").notNull().default("user"),
  createdAt: text("created_at").notNull(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
});

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  category: text("category").notNull(),
  createdAt: text("created_at").notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.userId] })],
);

export const invitations = pgTable("invitations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  deliveryStatus: text("delivery_status").notNull().default("pending"),
  deliveryProvider: text("delivery_provider"),
  deliveryAttempts: integer("delivery_attempts").notNull().default(0),
  deliveryLastAttemptAt: text("delivery_last_attempt_at"),
  deliveryErrorCode: text("delivery_error_code"),
  createdAt: text("created_at").notNull(),
});

export const businessProfiles = pgTable("business_profiles", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  data: text("data").notNull(),
  onboardingStep: integer("onboarding_step").notNull().default(1),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at").notNull(),
});

export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    status: text("status").notNull(),
    source: text("source").notNull(),
    tags: text("tags").notNull(),
    assignedUserId: text("assigned_user_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [unique().on(table.tenantId, table.email)],
);

export const contactMergeRecords = pgTable(
  "contact_merge_records",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    survivorContactId: text("survivor_contact_id").notNull(),
    mergedContactId: text("merged_contact_id").notNull(),
    reason: text("reason").notNull(),
    selectedFields: text("selected_fields").notNull(),
    mergedSnapshot: text("merged_snapshot").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [unique().on(table.tenantId, table.mergedContactId)],
);

export const opportunityRadarAlerts = pgTable(
  "opportunity_radar_alerts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ruleKey: text("rule_key").notNull(),
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    explanation: text("explanation").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    actionLabel: text("action_label").notNull(),
    actionHref: text("action_href").notNull(),
    status: text("status").notNull(),
    detectedAt: text("detected_at").notNull(),
    dismissedAt: text("dismissed_at"),
    resolvedAt: text("resolved_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    unique().on(table.tenantId, table.ruleKey, table.entityType, table.entityId),
  ],
);

export const leads = pgTable("leads", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  contactId: text("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  status: text("status").notNull(),
  opportunityValue: integer("opportunity_value").notNull(),
  pagePath: text("page_path").notNull(),
  createdAt: text("created_at").notNull(),
});

export const websites = pgTable("websites", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  templateKey: text("template_key").notNull(),
  theme: text("theme").notNull(),
  status: text("status").notNull(),
  currentVersionId: text("current_version_id"),
  currentDraftVersionId: text("current_draft_version_id"),
  currentPublishedVersionId: text("current_published_version_id"),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const websiteVersions = pgTable("website_versions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  websiteId: text("website_id")
    .notNull()
    .references(() => websites.id, { onDelete: "cascade" }),
  snapshot: text("snapshot").notNull(),
  approvalState: text("approval_state").notNull(),
  source: text("source").notNull(),
  versionType: text("version_type").notNull().default("draft"),
  createdAt: text("created_at").notNull(),
});

export const workflowRuns = pgTable("workflow_runs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  workflowKey: text("workflow_key").notNull(),
  triggerName: text("trigger_name").notNull(),
  status: text("status").notNull(),
  summary: text("summary").notNull(),
  error: text("error"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const workflowRunSteps = pgTable("workflow_run_steps", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  workflowRunId: text("workflow_run_id")
    .notNull()
    .references(() => workflowRuns.id, { onDelete: "cascade" }),
  actionName: text("action_name").notNull(),
  status: text("status").notNull(),
  safeMetadata: text("safe_metadata").notNull(),
  attempts: integer("attempts").notNull().default(1),
  scheduledAt: text("scheduled_at"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
});

export const domainEvents = pgTable("domain_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  actorId: text("actor_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull().default(0),
  idempotencyKey: text("idempotency_key").notNull(),
  correlationId: text("correlation_id").notNull(),
  causationId: text("causation_id"),
  nextRunAt: text("next_run_at").notNull(),
  lastError: text("last_error"),
  lastAttemptedAt: text("last_attempted_at"),
  lastRetryDelayMs: integer("last_retry_delay_ms").notNull().default(0),
  failureClassification: text("failure_classification"),
  maxAttempts: integer("max_attempts"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const rateLimits = pgTable("rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  operationKey: text("operation_key").notNull(),
  subjectHash: text("subject_hash").notNull(),
  scopeHash: text("scope_hash").notNull(),
  count: integer("count").notNull(),
  resetAt: text("reset_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
