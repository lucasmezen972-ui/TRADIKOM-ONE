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
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
