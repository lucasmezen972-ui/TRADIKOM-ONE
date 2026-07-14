import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { closePgPool, getDatabaseUrl, pgPoolAsSqlClient } from "@/db/client";
import { validateEnvironment } from "@/lib/environment";

export type QueryResult<T = Record<string, unknown>> = {
  rows: T[];
  affectedRows?: number;
};

export type DbClient = {
  query: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<QueryResult<T>>;
};

let dbPromise: Promise<DbClient> | null = null;
let pglitePromise: Promise<PGlite> | null = null;

export async function getDb(): Promise<DbClient> {
  if (!dbPromise) {
    validateEnvironment(process.env);
    dbPromise = createRuntimeDb();
  }

  return dbPromise;
}

export async function createMemoryDb(): Promise<PGlite> {
  const db = new PGlite();
  await migrate(db);
  return db;
}

export async function closeDb() {
  if (!dbPromise) {
    return;
  }

  if (pglitePromise) {
    const db = await pglitePromise;
    await db.close();
  }

  await closePgPool();

  dbPromise = null;
  pglitePromise = null;
}

export const closeDbForTests = closeDb;

async function createRuntimeDb() {
  if (getDatabaseUrl()) {
    const db = pgPoolAsSqlClient();
    await migrate(db, { enableRls: true });
    return db;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL must be configured in production.");
  }

  const dataDir =
    process.env.PGLITE_DATA_DIR ??
    path.join(process.cwd(), ".data", "tradikom-one-pglite");

  await mkdir(dataDir, { recursive: true });
  pglitePromise = Promise.resolve(new PGlite(dataDir));
  const db = await pglitePromise;
  await migrate(db, { enableRls: false });
  return db;
}

export type MigrationOptions = {
  enableRls?: boolean;
  targetMigrationId?: string;
};

export async function migrate(db: DbClient, options: MigrationOptions = {}) {
  await db.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at text not null
    );
  `);

  const availableMigrations = getMigrations(options.enableRls ?? false);
  const targetIndex = options.targetMigrationId
    ? availableMigrations.findIndex(
        (migration) => migration.id === options.targetMigrationId,
      )
    : availableMigrations.length - 1;

  if (targetIndex < 0) {
    throw new Error("Unknown database migration target.");
  }

  for (const migration of availableMigrations.slice(0, targetIndex + 1)) {
    const applied = await db.query<{ id: string }>(
      "select id from schema_migrations where id = $1",
      [migration.id],
    );

    if (applied.rows.length > 0) {
      continue;
    }

    for (const statement of splitSqlStatements(migration.sql)) {
      await db.query(statement);
    }

    await db.query(
      "insert into schema_migrations (id, applied_at) values ($1, $2)",
      [migration.id, new Date().toISOString()],
    );
  }
}

export function getMigrationIds(enableRls = false) {
  return getMigrations(enableRls).map((migration) => migration.id);
}

function getMigrations(enableRls: boolean) {
  return [
    { id: "001_initial", sql: initialMigrationSql },
    { id: "002_phase2_foundation", sql: phase2FoundationMigrationSql },
    ...(enableRls ? [{ id: "003_rls", sql: rlsMigrationSql }] : []),
    { id: "004_auth_flows", sql: authFlowsMigrationSql },
    { id: "005_crm_opportunity_depth", sql: crmOpportunityDepthMigrationSql },
    { id: "006_crm_contact_merges", sql: crmContactMergesMigrationSql },
    ...(enableRls
      ? [{ id: "007_crm_contact_merges_rls", sql: crmContactMergesRlsMigrationSql }]
      : []),
    { id: "008_opportunity_radar_alerts", sql: opportunityRadarAlertsMigrationSql },
    ...(enableRls
      ? [{ id: "009_opportunity_radar_alerts_rls", sql: opportunityRadarAlertsRlsMigrationSql }]
      : []),
    { id: "010_workflow_step_attempts", sql: workflowStepAttemptsMigrationSql },
    { id: "011_domain_event_attempt_metadata", sql: domainEventAttemptMetadataMigrationSql },
    { id: "012_webhook_delivery_idempotency", sql: webhookDeliveryIdempotencyMigrationSql },
    { id: "013_rate_limit_scopes", sql: rateLimitScopesMigrationSql },
    { id: "014_invitation_delivery", sql: invitationDeliveryMigrationSql },
    ...(enableRls
      ? [{ id: "015_rls_policy_completion", sql: rlsPolicyCompletionMigrationSql }]
      : []),
    ...(enableRls
      ? [{ id: "016_tenant_integrity", sql: tenantIntegrityMigrationSql }]
      : []),
    { id: "017_phase3_api_intelligence", sql: phase3ApiIntelligenceMigrationSql },
    ...(enableRls
      ? [{ id: "018_phase3_api_intelligence_rls", sql: phase3ApiIntelligenceRlsMigrationSql }]
      : []),
    { id: "019_phase3_api_change_monitor", sql: phase3ApiChangeMonitorMigrationSql },
    ...(enableRls
      ? [{ id: "020_phase3_api_change_monitor_rls", sql: phase3ApiChangeMonitorRlsMigrationSql }]
      : []),
    { id: "021_phase3_api_source_rechecks", sql: phase3ApiSourceRechecksMigrationSql },
    { id: "022_phase3_api_discovery_candidates", sql: phase3ApiDiscoveryCandidatesMigrationSql },
    { id: "023_phase3_connector_repairs", sql: phase3ConnectorRepairsMigrationSql },
    ...(enableRls
      ? [{ id: "024_phase3_connector_repairs_rls", sql: phase3ConnectorRepairsRlsMigrationSql }]
      : []),
    { id: "025_phase3_versioned_api_imports", sql: phase3VersionedApiImportsMigrationSql },
    { id: "026_phase3_reusable_mapping_intelligence", sql: phase3ReusableMappingIntelligenceMigrationSql },
    { id: "027_phase4_business_brain", sql: phase4BusinessBrainMigrationSql },
    ...(enableRls
      ? [{ id: "028_phase4_business_brain_rls", sql: phase4BusinessBrainRlsMigrationSql }]
      : []),
    { id: "029_phase4_strategic_advisor", sql: phase4StrategicAdvisorMigrationSql },
    ...(enableRls
      ? [{ id: "030_phase4_strategic_advisor_rls", sql: phase4StrategicAdvisorRlsMigrationSql }]
      : []),
    { id: "031_phase4_autonomous_marketing", sql: phase4AutonomousMarketingMigrationSql },
    ...(enableRls
      ? [{ id: "032_phase4_autonomous_marketing_rls", sql: phase4AutonomousMarketingRlsMigrationSql }]
      : []),
    { id: "033_phase4_website_ai", sql: phase4WebsiteAiMigrationSql },
    ...(enableRls
      ? [{ id: "034_phase4_website_ai_rls", sql: phase4WebsiteAiRlsMigrationSql }]
      : []),
    { id: "035_phase4_sales_ai", sql: phase4SalesAiMigrationSql },
    ...(enableRls
      ? [{ id: "036_phase4_sales_ai_rls", sql: phase4SalesAiRlsMigrationSql }]
      : []),
    { id: "037_phase4_reputation_ai", sql: phase4ReputationAiMigrationSql },
    ...(enableRls
      ? [{ id: "038_phase4_reputation_ai_rls", sql: phase4ReputationAiRlsMigrationSql }]
      : []),
    {
      id: "039_phase4_competitor_intelligence",
      sql: phase4CompetitorIntelligenceMigrationSql,
    },
    ...(enableRls
      ? [{
          id: "040_phase4_competitor_intelligence_rls",
          sql: phase4CompetitorIntelligenceRlsMigrationSql,
        }]
      : []),
    { id: "041_phase4_financial_ai", sql: phase4FinancialAiMigrationSql },
    ...(enableRls
      ? [{ id: "042_phase4_financial_ai_rls", sql: phase4FinancialAiRlsMigrationSql }]
      : []),
    { id: "043_phase4_ai_employees", sql: phase4AiEmployeesMigrationSql },
    ...(enableRls
      ? [{ id: "044_phase4_ai_employees_rls", sql: phase4AiEmployeesRlsMigrationSql }]
      : []),
    {
      id: "045_phase4_universal_connectors",
      sql: phase4UniversalConnectorsMigrationSql,
    },
    ...(enableRls
      ? [{
          id: "046_phase4_universal_connectors_rls",
          sql: phase4UniversalConnectorsRlsMigrationSql,
        }]
      : []),
    {
      id: "047_phase4_private_app_marketplace",
      sql: phase4PrivateAppMarketplaceMigrationSql,
    },
    ...(enableRls
      ? [{
          id: "048_phase4_private_app_marketplace_rls",
          sql: phase4PrivateAppMarketplaceRlsMigrationSql,
        }]
      : []),
  ];
}

function splitSqlStatements(sql: string) {
  const statements: string[] = [];
  let current = "";
  let inDollarQuote = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const pair = sql.slice(index, index + 2);

    if (pair === "$$") {
      inDollarQuote = !inDollarQuote;
      current += pair;
      index += 1;
      continue;
    }

    if (char === ";" && !inDollarQuote) {
      const statement = current.trim();
      if (statement) {
        statements.push(statement);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const finalStatement = current.trim();
  if (finalStatement) {
    statements.push(finalStatement);
  }

  return statements;
}

const initialMigrationSql = `
create table users (
  id text primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  created_at text not null
);

create table sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at text not null,
  revoked_at text,
  created_at text not null
);

create table password_reset_tokens (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null,
  expires_at text not null,
  used_at text
);

create table tenants (
  id text primary key,
  name text not null,
  slug text not null unique,
  category text not null,
  created_at text not null
);

create table memberships (
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null,
  created_at text not null,
  primary key (tenant_id, user_id)
);

create table invitations (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  email text not null,
  role text not null,
  status text not null,
  token_hash text not null,
  expires_at text not null,
  created_at text not null
);

create table business_profiles (
  tenant_id text primary key references tenants(id) on delete cascade,
  data text not null,
  onboarding_step integer not null default 1,
  completed_at text,
  updated_at text not null
);

create table knowledge_documents (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  title text not null,
  source_type text not null,
  safe_metadata text not null,
  created_at text not null
);

create table pipelines (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  created_at text not null
);

create table pipeline_stages (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  pipeline_id text not null references pipelines(id) on delete cascade,
  name text not null,
  position integer not null
);

create table contacts (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  email text not null,
  phone text not null,
  status text not null,
  source text not null,
  tags text not null,
  assigned_user_id text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, email)
);

create table contact_merge_records (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  survivor_contact_id text not null,
  merged_contact_id text not null,
  reason text not null,
  selected_fields text not null,
  merged_snapshot text not null,
  created_by text not null,
  created_at text not null,
  unique (tenant_id, merged_contact_id)
);

create table opportunity_radar_alerts (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  rule_key text not null,
  severity text not null,
  title text not null,
  explanation text not null,
  entity_type text not null,
  entity_id text not null,
  action_label text not null,
  action_href text not null,
  status text not null,
  detected_at text not null,
  dismissed_at text,
  resolved_at text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, rule_key, entity_type, entity_id)
);

create table companies (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  domain text,
  created_at text not null
);

create table contact_consents (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  contact_id text not null references contacts(id) on delete cascade,
  marketing_opt_in integer not null,
  privacy_notice_accepted_at text,
  data_retention_until text
);

create table opportunities (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  contact_id text not null references contacts(id) on delete cascade,
  stage_id text not null references pipeline_stages(id),
  value_cents integer not null,
  next_follow_up_at text,
  lost_reason text,
  created_at text not null,
  updated_at text not null
);

create table leads (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  contact_id text not null references contacts(id) on delete cascade,
  source text not null,
  status text not null,
  opportunity_value integer not null,
  page_path text not null,
  created_at text not null
);

create table activities (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  type text not null,
  summary text not null,
  target_type text not null,
  target_id text not null,
  created_at text not null
);

create table notes (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  body text not null,
  target_type text not null,
  target_id text not null,
  created_at text not null
);

create table tasks (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  title text not null,
  status text not null,
  assigned_user_id text not null references users(id),
  due_at text not null,
  related_type text not null,
  related_id text not null,
  created_at text not null
);

create table websites (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  template_key text not null,
  theme text not null,
  status text not null,
  current_version_id text,
  published_at text,
  created_at text not null,
  updated_at text not null
);

create table website_pages (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  website_id text not null references websites(id) on delete cascade,
  slug text not null,
  title text not null,
  seo_metadata text not null,
  created_at text not null
);

create table website_sections (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  website_id text not null references websites(id) on delete cascade,
  type text not null,
  position integer not null,
  enabled integer not null,
  title text not null,
  body text not null,
  image_url text,
  button_label text,
  button_href text,
  data text not null
);

create table website_versions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  website_id text not null references websites(id) on delete cascade,
  snapshot text not null,
  approval_state text not null,
  source text not null,
  created_at text not null
);

create table website_publications (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  website_id text not null references websites(id) on delete cascade,
  version_id text not null references website_versions(id),
  local_url text not null,
  published_at text not null
);

create table forms (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  website_id text not null references websites(id) on delete cascade,
  name text not null,
  created_at text not null
);

create table form_fields (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  form_id text not null references forms(id) on delete cascade,
  label text not null,
  field_key text not null,
  required integer not null
);

create table form_submissions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  form_id text,
  website_id text not null references websites(id) on delete cascade,
  payload text not null,
  created_contact_id text,
  idempotency_key text not null,
  created_at text not null,
  unique (tenant_id, idempotency_key)
);

create table workflows (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  workflow_key text not null,
  name text not null,
  trigger_name text not null,
  status text not null,
  approval_policy text not null,
  definition text not null,
  created_at text not null,
  unique (tenant_id, workflow_key)
);

create table workflow_runs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  workflow_key text not null,
  trigger_name text not null,
  status text not null,
  summary text not null,
  error text,
  retry_count integer not null default 0,
  created_at text not null
);

create table workflow_run_steps (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  workflow_run_id text not null references workflow_runs(id) on delete cascade,
  action_name text not null,
  status text not null,
  safe_metadata text not null,
  attempts integer not null default 1,
  scheduled_at text,
  started_at text,
  completed_at text,
  error text,
  created_at text not null
);

create table approvals (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  requested_by text not null,
  policy text not null,
  status text not null,
  target_type text not null,
  target_id text not null,
  created_at text not null
);

create table connectors (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  connector_key text not null,
  status text not null,
  health text not null,
  safe_config text not null,
  last_sync_at text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, connector_key)
);

create table connector_accounts (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  connector_key text not null,
  external_account_name text not null,
  status text not null,
  created_at text not null
);

create table connector_credentials (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  connector_key text not null,
  encrypted_payload text not null,
  created_at text not null
);

create table connector_sync_runs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  connector_key text not null,
  status text not null,
  summary text not null,
  created_at text not null
);

create table webhook_endpoints (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  token text not null unique,
  secret_hash text,
  status text not null,
  created_at text not null
);

create table webhook_deliveries (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  webhook_endpoint_id text not null references webhook_endpoints(id),
  status text not null,
  idempotency_key text,
  payload text not null,
  error text,
  created_at text not null
);

create table external_record_mappings (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  connector_key text not null,
  external_id text not null,
  internal_type text not null,
  internal_id text not null
);

create table imports (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  source text not null,
  status text not null,
  report text not null,
  created_at text not null
);

create table import_rows (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  import_id text not null references imports(id) on delete cascade,
  row_number integer not null,
  status text not null,
  safe_data text not null,
  error text
);

create table notifications (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  channel text not null,
  recipient_user_id text not null,
  message text not null,
  status text not null,
  created_at text not null
);

create table audit_logs (
  id text primary key,
  tenant_id text not null,
  actor_id text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  safe_metadata text not null,
  correlation_id text not null,
  created_at text not null
);

create index idx_sessions_user on sessions(user_id);
create index idx_memberships_user on memberships(user_id);
create index idx_contacts_tenant on contacts(tenant_id);
create index idx_leads_tenant on leads(tenant_id);
create index idx_tasks_tenant on tasks(tenant_id);
create index idx_activities_tenant on activities(tenant_id);
create index idx_website_sections_tenant on website_sections(tenant_id, website_id);
create index idx_audit_logs_tenant on audit_logs(tenant_id, created_at desc);
create index idx_webhook_token on webhook_endpoints(token);
`;

const phase2FoundationMigrationSql = `
alter table sessions add column if not exists token_hash text;
alter table sessions add column if not exists revoked_at text;
create unique index if not exists idx_sessions_token_hash on sessions(token_hash);

alter table websites add column if not exists current_draft_version_id text;
alter table websites add column if not exists current_published_version_id text;
alter table website_versions add column if not exists version_type text not null default 'draft';

create table if not exists domain_events (
  id text primary key,
  tenant_id text not null,
  actor_id text not null,
  event_type text not null,
  payload text not null,
  status text not null,
  attempts integer not null default 0,
  idempotency_key text not null,
  correlation_id text not null,
  causation_id text,
  next_run_at text not null,
  last_error text,
  last_attempted_at text,
  last_retry_delay_ms integer not null default 0,
  failure_classification text,
  max_attempts integer,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, idempotency_key)
);

create table if not exists rate_limits (
  id text primary key,
  key text not null unique,
  count integer not null,
  reset_at text not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists generation_records (
  id text primary key,
  tenant_id text not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  generation_type text not null,
  input_refs text not null,
  output text not null,
  usage_metadata text not null,
  approval_status text not null,
  created_at text not null
);

create table if not exists connector_secret_versions (
  id text primary key,
  tenant_id text not null,
  connector_key text not null,
  key_version text not null,
  encrypted_payload text not null,
  created_at text not null
);

create index if not exists idx_domain_events_status on domain_events(status, next_run_at);
create index if not exists idx_generation_records_tenant on generation_records(tenant_id, created_at desc);
create index if not exists idx_connector_secret_versions_tenant on connector_secret_versions(tenant_id, connector_key);
`;

const authFlowsMigrationSql = `
create unique index if not exists idx_password_reset_tokens_token_hash on password_reset_tokens(token_hash);
create index if not exists idx_password_reset_tokens_user on password_reset_tokens(user_id);
create unique index if not exists idx_invitations_token_hash on invitations(token_hash);
create index if not exists idx_invitations_tenant_email_status on invitations(tenant_id, email, status);
`;

const crmOpportunityDepthMigrationSql = `
alter table opportunities add column if not exists lost_reason text;
`;

const crmContactMergesMigrationSql = `
create table if not exists contact_merge_records (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  survivor_contact_id text not null,
  merged_contact_id text not null,
  reason text not null,
  selected_fields text not null,
  merged_snapshot text not null,
  created_by text not null,
  created_at text not null,
  unique (tenant_id, merged_contact_id)
);
`;

const crmContactMergesRlsMigrationSql = `
alter table contact_merge_records enable row level security;

drop policy if exists tenant_contact_merge_records on contact_merge_records;
create policy tenant_contact_merge_records on contact_merge_records
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
`;

const opportunityRadarAlertsMigrationSql = `
create table if not exists opportunity_radar_alerts (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  rule_key text not null,
  severity text not null,
  title text not null,
  explanation text not null,
  entity_type text not null,
  entity_id text not null,
  action_label text not null,
  action_href text not null,
  status text not null,
  detected_at text not null,
  dismissed_at text,
  resolved_at text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, rule_key, entity_type, entity_id)
);
`;

const opportunityRadarAlertsRlsMigrationSql = `
alter table opportunity_radar_alerts enable row level security;

drop policy if exists tenant_opportunity_radar_alerts on opportunity_radar_alerts;
create policy tenant_opportunity_radar_alerts on opportunity_radar_alerts
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
`;

const workflowStepAttemptsMigrationSql = `
alter table workflow_run_steps add column if not exists attempts integer not null default 1;
alter table workflow_run_steps add column if not exists scheduled_at text;
alter table workflow_run_steps add column if not exists started_at text;
alter table workflow_run_steps add column if not exists completed_at text;
alter table workflow_run_steps add column if not exists error text;
create index if not exists idx_workflow_run_steps_attempts on workflow_run_steps(tenant_id, workflow_run_id, action_name, created_at desc);
`;

const domainEventAttemptMetadataMigrationSql = `
alter table domain_events add column if not exists last_attempted_at text;
alter table domain_events add column if not exists last_retry_delay_ms integer not null default 0;
alter table domain_events add column if not exists failure_classification text;
alter table domain_events add column if not exists max_attempts integer;
create index if not exists idx_domain_events_failure on domain_events(tenant_id, status, failure_classification, updated_at desc);
`;

const webhookDeliveryIdempotencyMigrationSql = `
alter table webhook_deliveries add column if not exists idempotency_key text;
create index if not exists idx_webhook_deliveries_endpoint_idempotency
  on webhook_deliveries(webhook_endpoint_id, idempotency_key);
create unique index if not exists idx_webhook_deliveries_accepted_idempotency
  on webhook_deliveries(webhook_endpoint_id, idempotency_key)
  where idempotency_key is not null and status = 'accepted';
`;

const rateLimitScopesMigrationSql = `
alter table rate_limits add column if not exists operation_key text not null default 'legacy';
alter table rate_limits add column if not exists subject_hash text not null default '';
alter table rate_limits add column if not exists scope_hash text not null default '';
create index if not exists idx_rate_limits_operation_scope on rate_limits(operation_key, scope_hash, reset_at);
create index if not exists idx_rate_limits_cleanup on rate_limits(reset_at);
`;

const invitationDeliveryMigrationSql = `
alter table invitations add column if not exists delivery_status text not null default 'pending';
alter table invitations add column if not exists delivery_provider text;
alter table invitations add column if not exists delivery_attempts integer not null default 0;
alter table invitations add column if not exists delivery_last_attempt_at text;
alter table invitations add column if not exists delivery_error_code text;

create index if not exists idx_invitations_delivery_status
  on invitations(tenant_id, delivery_status, created_at desc);
`;

const rlsMigrationSql = `
create or replace function app_current_tenant_id()
returns text
language sql
stable
as $$
  select nullif(current_setting('app.tenant_id', true), '')
$$;

create or replace function app_is_system()
returns boolean
language sql
stable
as $$
  select
    coalesce(nullif(current_setting('app.system_access', true), ''), 'false') = 'true'
    and pg_has_role(
      current_user,
      (select relowner from pg_class where oid = 'public.tenants'::regclass),
      'MEMBER'
    )
$$;

alter table business_profiles enable row level security;
alter table knowledge_documents enable row level security;
alter table contacts enable row level security;
alter table contact_merge_records enable row level security;
alter table opportunity_radar_alerts enable row level security;
alter table companies enable row level security;
alter table contact_consents enable row level security;
alter table pipelines enable row level security;
alter table pipeline_stages enable row level security;
alter table opportunities enable row level security;
alter table leads enable row level security;
alter table activities enable row level security;
alter table notes enable row level security;
alter table tasks enable row level security;
alter table websites enable row level security;
alter table website_pages enable row level security;
alter table website_sections enable row level security;
alter table website_versions enable row level security;
alter table website_publications enable row level security;
alter table forms enable row level security;
alter table form_fields enable row level security;
alter table form_submissions enable row level security;
alter table workflows enable row level security;
alter table workflow_runs enable row level security;
alter table workflow_run_steps enable row level security;
alter table approvals enable row level security;
alter table connectors enable row level security;
alter table connector_accounts enable row level security;
alter table connector_credentials enable row level security;
alter table connector_sync_runs enable row level security;
alter table webhook_endpoints enable row level security;
alter table webhook_deliveries enable row level security;
alter table external_record_mappings enable row level security;
alter table imports enable row level security;
alter table import_rows enable row level security;
alter table notifications enable row level security;
alter table audit_logs enable row level security;
alter table domain_events enable row level security;
alter table generation_records enable row level security;
alter table connector_secret_versions enable row level security;

drop policy if exists tenant_contacts on contacts;
create policy tenant_contacts on contacts
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_contact_merge_records on contact_merge_records;
create policy tenant_contact_merge_records on contact_merge_records
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_opportunity_radar_alerts on opportunity_radar_alerts;
create policy tenant_opportunity_radar_alerts on opportunity_radar_alerts
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_leads on leads;
create policy tenant_leads on leads
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_tasks on tasks;
create policy tenant_tasks on tasks
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_websites on websites;
create policy tenant_websites on websites
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_website_versions on website_versions;
create policy tenant_website_versions on website_versions
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_audit_logs on audit_logs;
create policy tenant_audit_logs on audit_logs
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
`;

const rlsPolicyCompletionMigrationSql = `
create or replace function app_is_system()
returns boolean
language sql
stable
as $$
  select
    coalesce(nullif(current_setting('app.system_access', true), ''), 'false') = 'true'
    and pg_has_role(
      current_user,
      (select relowner from pg_class where oid = 'public.tenants'::regclass),
      'MEMBER'
    )
$$;

do $$
declare
  tenant_table record;
begin
  for tenant_table in
    select columns.table_name
    from information_schema.columns as columns
    where columns.table_schema = 'public'
      and columns.column_name = 'tenant_id'
  loop
    execute format(
      'alter table public.%I enable row level security',
      tenant_table.table_name
    );
    execute format(
      'drop policy if exists tenant_isolation on public.%I',
      tenant_table.table_name
    );
    execute format(
      'create policy tenant_isolation on public.%I using (app_is_system() or tenant_id = app_current_tenant_id()) with check (app_is_system() or tenant_id = app_current_tenant_id())',
      tenant_table.table_name
    );
  end loop;
end
$$;

alter table tenants enable row level security;
drop policy if exists tenant_isolation on tenants;
create policy tenant_isolation on tenants
  using (app_is_system() or id = app_current_tenant_id())
  with check (app_is_system() or id = app_current_tenant_id());
`;

const tenantIntegrityMigrationSql = `
create or replace function app_enforce_related_tenant()
returns trigger
language plpgsql
as $$
declare
  related_id text;
  related_tenant_id text;
begin
  related_id := to_jsonb(new) ->> tg_argv[1];
  if related_id is null or related_id = '' then
    return new;
  end if;

  execute format(
    'select tenant_id from public.%I where id = $1',
    tg_argv[0]
  ) into related_tenant_id using related_id;

  if related_tenant_id is null then
    raise exception using
      errcode = '23503',
      message = 'Related tenant row not found.';
  end if;

  if related_tenant_id <> new.tenant_id then
    raise exception using
      errcode = '23514',
      message = 'Cross-tenant relation rejected.';
  end if;

  return new;
end
$$;

drop trigger if exists pipeline_stages_tenant_integrity on pipeline_stages;
create trigger pipeline_stages_tenant_integrity
  before insert or update of tenant_id, pipeline_id on pipeline_stages
  for each row execute function app_enforce_related_tenant('pipelines', 'pipeline_id');

drop trigger if exists contact_consents_tenant_integrity on contact_consents;
create trigger contact_consents_tenant_integrity
  before insert or update of tenant_id, contact_id on contact_consents
  for each row execute function app_enforce_related_tenant('contacts', 'contact_id');

drop trigger if exists opportunities_contact_tenant_integrity on opportunities;
create trigger opportunities_contact_tenant_integrity
  before insert or update of tenant_id, contact_id on opportunities
  for each row execute function app_enforce_related_tenant('contacts', 'contact_id');

drop trigger if exists opportunities_stage_tenant_integrity on opportunities;
create trigger opportunities_stage_tenant_integrity
  before insert or update of tenant_id, stage_id on opportunities
  for each row execute function app_enforce_related_tenant('pipeline_stages', 'stage_id');

drop trigger if exists leads_tenant_integrity on leads;
create trigger leads_tenant_integrity
  before insert or update of tenant_id, contact_id on leads
  for each row execute function app_enforce_related_tenant('contacts', 'contact_id');

drop trigger if exists website_pages_tenant_integrity on website_pages;
create trigger website_pages_tenant_integrity
  before insert or update of tenant_id, website_id on website_pages
  for each row execute function app_enforce_related_tenant('websites', 'website_id');

drop trigger if exists website_sections_tenant_integrity on website_sections;
create trigger website_sections_tenant_integrity
  before insert or update of tenant_id, website_id on website_sections
  for each row execute function app_enforce_related_tenant('websites', 'website_id');

drop trigger if exists website_versions_tenant_integrity on website_versions;
create trigger website_versions_tenant_integrity
  before insert or update of tenant_id, website_id on website_versions
  for each row execute function app_enforce_related_tenant('websites', 'website_id');

drop trigger if exists websites_draft_tenant_integrity on websites;
create trigger websites_draft_tenant_integrity
  before insert or update of tenant_id, current_draft_version_id on websites
  for each row execute function app_enforce_related_tenant('website_versions', 'current_draft_version_id');

drop trigger if exists websites_published_tenant_integrity on websites;
create trigger websites_published_tenant_integrity
  before insert or update of tenant_id, current_published_version_id on websites
  for each row execute function app_enforce_related_tenant('website_versions', 'current_published_version_id');

drop trigger if exists website_publications_website_tenant_integrity on website_publications;
create trigger website_publications_website_tenant_integrity
  before insert or update of tenant_id, website_id on website_publications
  for each row execute function app_enforce_related_tenant('websites', 'website_id');

drop trigger if exists website_publications_version_tenant_integrity on website_publications;
create trigger website_publications_version_tenant_integrity
  before insert or update of tenant_id, version_id on website_publications
  for each row execute function app_enforce_related_tenant('website_versions', 'version_id');

drop trigger if exists forms_tenant_integrity on forms;
create trigger forms_tenant_integrity
  before insert or update of tenant_id, website_id on forms
  for each row execute function app_enforce_related_tenant('websites', 'website_id');

drop trigger if exists form_fields_tenant_integrity on form_fields;
create trigger form_fields_tenant_integrity
  before insert or update of tenant_id, form_id on form_fields
  for each row execute function app_enforce_related_tenant('forms', 'form_id');

drop trigger if exists form_submissions_form_tenant_integrity on form_submissions;
create trigger form_submissions_form_tenant_integrity
  before insert or update of tenant_id, form_id on form_submissions
  for each row execute function app_enforce_related_tenant('forms', 'form_id');

drop trigger if exists form_submissions_website_tenant_integrity on form_submissions;
create trigger form_submissions_website_tenant_integrity
  before insert or update of tenant_id, website_id on form_submissions
  for each row execute function app_enforce_related_tenant('websites', 'website_id');

drop trigger if exists form_submissions_contact_tenant_integrity on form_submissions;
create trigger form_submissions_contact_tenant_integrity
  before insert or update of tenant_id, created_contact_id on form_submissions
  for each row execute function app_enforce_related_tenant('contacts', 'created_contact_id');

drop trigger if exists workflow_run_steps_tenant_integrity on workflow_run_steps;
create trigger workflow_run_steps_tenant_integrity
  before insert or update of tenant_id, workflow_run_id on workflow_run_steps
  for each row execute function app_enforce_related_tenant('workflow_runs', 'workflow_run_id');

drop trigger if exists webhook_deliveries_tenant_integrity on webhook_deliveries;
create trigger webhook_deliveries_tenant_integrity
  before insert or update of tenant_id, webhook_endpoint_id on webhook_deliveries
  for each row execute function app_enforce_related_tenant('webhook_endpoints', 'webhook_endpoint_id');

drop trigger if exists import_rows_tenant_integrity on import_rows;
create trigger import_rows_tenant_integrity
  before insert or update of tenant_id, import_id on import_rows
  for each row execute function app_enforce_related_tenant('imports', 'import_id');

do $$
declare
  tenant_table record;
  has_tenant_index boolean;
begin
  for tenant_table in
    select columns.table_name
    from information_schema.columns as columns
    where columns.table_schema = 'public'
      and columns.column_name = 'tenant_id'
  loop
    select exists (
      select 1
      from pg_index as indexes
      join pg_attribute as attributes
        on attributes.attrelid = indexes.indrelid
       and attributes.attnum = any(indexes.indkey)
      where indexes.indrelid = format('public.%I', tenant_table.table_name)::regclass
        and attributes.attname = 'tenant_id'
    ) into has_tenant_index;

    if not has_tenant_index then
      execute format(
        'create index %I on public.%I (tenant_id)',
        'idx_' || tenant_table.table_name || '_tenant_scope',
        tenant_table.table_name
      );
    end if;
  end loop;
end
$$;
`;

const phase3ApiIntelligenceMigrationSql = `
alter table users add column if not exists platform_role text not null default 'user';

create table if not exists software_directory_entries (
  id text primary key,
  canonical_name text not null,
  aliases text not null,
  vendor text not null,
  official_domain text not null unique,
  country text,
  supported_regions text not null,
  languages text not null,
  industries text not null,
  categories text not null,
  official_website text not null,
  developer_portal text,
  support_page text,
  partner_program_page text,
  pricing_information_page text,
  verification_status text not null,
  confidence_score integer not null,
  last_verified_at text,
  evidence_count integer not null default 0,
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null
);

create table if not exists software_domains (
  id text primary key,
  software_id text not null references software_directory_entries(id) on delete cascade,
  domain text not null unique,
  approval_status text not null,
  decision_reason text,
  approved_by text references users(id),
  approved_at text,
  created_at text not null,
  updated_at text not null
);

create table if not exists api_products (
  id text primary key,
  software_id text not null references software_directory_entries(id) on delete cascade,
  name text not null,
  api_style text not null,
  version text not null,
  base_url text,
  documentation_url text not null,
  openapi_url text,
  postman_collection_url text,
  graphql_schema_url text,
  authentication_type text not null,
  oauth_metadata text not null,
  scopes text not null,
  webhook_support integer not null default 0,
  sandbox_support integer not null default 0,
  partner_access_requirement integer not null default 0,
  access_level text not null,
  rate_limit_information text,
  deprecation_status text not null,
  terms_url text,
  confidence_score integer not null,
  last_verified_at text,
  created_at text not null,
  updated_at text not null,
  unique (software_id, name, version)
);

create table if not exists api_sources (
  id text primary key,
  software_id text not null references software_directory_entries(id) on delete cascade,
  api_product_id text references api_products(id) on delete set null,
  canonical_url text not null unique,
  source_type text not null,
  source_classification text not null,
  publisher_domain text not null,
  created_by text not null references users(id),
  created_at text not null
);

create table if not exists api_source_snapshots (
  id text primary key,
  source_id text not null references api_sources(id) on delete cascade,
  retrieved_at text not null,
  http_status integer not null,
  etag text,
  last_modified text,
  content_hash text not null,
  parser_version text not null,
  robots_decision text not null,
  access_policy_decision text not null,
  content_type text not null,
  content text not null,
  safe_metadata text not null,
  created_at text not null,
  unique (source_id, content_hash)
);

create table if not exists api_schemas (
  id text primary key,
  api_product_id text not null references api_products(id) on delete cascade,
  source_snapshot_id text not null references api_source_snapshots(id) on delete cascade,
  schema_name text not null,
  schema_document text not null,
  created_at text not null,
  unique (api_product_id, source_snapshot_id, schema_name)
);

create table if not exists api_operations (
  id text primary key,
  api_product_id text not null references api_products(id) on delete cascade,
  source_snapshot_id text not null references api_source_snapshots(id) on delete cascade,
  operation_key text not null,
  method text not null,
  path text not null,
  summary text not null,
  tags text not null,
  capability text not null,
  deprecated integer not null default 0,
  request_schema_ref text,
  response_schema_ref text,
  security_requirements text not null,
  created_at text not null,
  unique (api_product_id, operation_key)
);

create table if not exists api_claims (
  id text primary key,
  source_snapshot_id text not null references api_source_snapshots(id) on delete cascade,
  subject_type text not null,
  subject_id text not null,
  claim_type text not null,
  claim_value text not null,
  confidence text not null,
  approval_status text not null,
  created_at text not null
);

create table if not exists api_evidence (
  id text primary key,
  claim_id text not null references api_claims(id) on delete cascade,
  source_snapshot_id text not null references api_source_snapshots(id) on delete cascade,
  locator text not null,
  excerpt_hash text not null,
  created_at text not null
);

create table if not exists api_verification_decisions (
  id text primary key,
  claim_id text not null references api_claims(id) on delete cascade,
  decision text not null,
  reason text not null,
  decided_by text not null references users(id),
  created_at text not null
);

create table if not exists api_contradictions (
  id text primary key,
  claim_id text not null references api_claims(id) on delete cascade,
  contradicting_claim_id text not null references api_claims(id) on delete cascade,
  status text not null,
  created_at text not null
);

create table if not exists api_global_mappings (
  id text primary key,
  api_product_id text not null references api_products(id) on delete cascade,
  source_entity text not null,
  canonical_entity text not null,
  source_field text,
  canonical_field text,
  confidence integer not null,
  evidence_id text not null references api_evidence(id),
  approval_status text not null,
  version integer not null,
  created_by text not null references users(id),
  approved_by text references users(id),
  created_at text not null,
  updated_at text not null
);

create table if not exists api_tenant_mappings (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  api_product_id text not null references api_products(id) on delete cascade,
  source_entity text not null,
  canonical_entity text not null,
  source_field text,
  canonical_field text,
  confidence integer not null,
  evidence_id text not null references api_evidence(id),
  approval_status text not null,
  version integer not null,
  created_by text not null references users(id),
  approved_by text references users(id),
  created_at text not null,
  updated_at text not null
);

create table if not exists api_compatibility_checks (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  software_id text not null references software_directory_entries(id) on delete cascade,
  api_product_id text not null references api_products(id) on delete cascade,
  desired_automation text not null,
  outcome text not null,
  result text not null,
  created_by text not null references users(id),
  created_at text not null
);

create table if not exists connector_proposals (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  software_id text not null references software_directory_entries(id) on delete cascade,
  api_product_id text not null references api_products(id) on delete cascade,
  name text not null,
  version text not null,
  status text not null,
  enabled integer not null default 0,
  manifest text not null,
  unresolved_questions text not null,
  risk_assessment text not null,
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null
);

create table if not exists connector_contract_runs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  connector_proposal_id text not null references connector_proposals(id) on delete cascade,
  connector_version text not null,
  api_version text not null,
  test_suite_version text not null,
  environment text not null,
  status text not null,
  results text not null,
  safe_logs text not null,
  created_at text not null
);

create table if not exists connector_approval_requests (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  connector_proposal_id text not null references connector_proposals(id) on delete cascade,
  requested_scope text not null,
  status text not null,
  submitted_by text not null references users(id),
  decided_by text references users(id),
  decision_reason text,
  created_at text not null,
  decided_at text
);

create table if not exists private_connect_store_entries (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  connector_proposal_id text not null references connector_proposals(id) on delete cascade,
  verification_status text not null,
  installation_status text not null,
  last_tested_at text not null,
  known_limitations text not null,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, connector_proposal_id)
);

create index if not exists idx_software_domains_status on software_domains(approval_status, domain);
create index if not exists idx_api_sources_software on api_sources(software_id, publisher_domain);
create index if not exists idx_api_snapshots_source on api_source_snapshots(source_id, retrieved_at desc);
create index if not exists idx_api_operations_product on api_operations(api_product_id, capability, path);
create index if not exists idx_api_schemas_product on api_schemas(api_product_id, schema_name);
create index if not exists idx_api_claims_subject on api_claims(subject_type, subject_id, claim_type);
create index if not exists idx_api_tenant_mappings_tenant on api_tenant_mappings(tenant_id, api_product_id);
create index if not exists idx_api_compatibility_tenant on api_compatibility_checks(tenant_id, created_at desc);
create index if not exists idx_connector_proposals_tenant on connector_proposals(tenant_id, status, updated_at desc);
create index if not exists idx_connector_contract_runs_tenant on connector_contract_runs(tenant_id, connector_proposal_id, created_at desc);
create index if not exists idx_connector_approval_requests_tenant on connector_approval_requests(tenant_id, status, created_at desc);
create index if not exists idx_private_connect_store_tenant on private_connect_store_entries(tenant_id, updated_at desc);
`;

const phase3ApiIntelligenceRlsMigrationSql = `
alter table api_tenant_mappings enable row level security;
alter table api_compatibility_checks enable row level security;
alter table connector_proposals enable row level security;
alter table connector_contract_runs enable row level security;
alter table connector_approval_requests enable row level security;
alter table private_connect_store_entries enable row level security;

drop policy if exists tenant_isolation on api_tenant_mappings;
create policy tenant_isolation on api_tenant_mappings
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
drop policy if exists tenant_isolation on api_compatibility_checks;
create policy tenant_isolation on api_compatibility_checks
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
drop policy if exists tenant_isolation on connector_proposals;
create policy tenant_isolation on connector_proposals
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
drop policy if exists tenant_isolation on connector_contract_runs;
create policy tenant_isolation on connector_contract_runs
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
drop policy if exists tenant_isolation on connector_approval_requests;
create policy tenant_isolation on connector_approval_requests
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
drop policy if exists tenant_isolation on private_connect_store_entries;
create policy tenant_isolation on private_connect_store_entries
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop trigger if exists connector_contract_runs_tenant_integrity on connector_contract_runs;
create trigger connector_contract_runs_tenant_integrity
  before insert or update of tenant_id, connector_proposal_id on connector_contract_runs
  for each row execute function app_enforce_related_tenant('connector_proposals', 'connector_proposal_id');
drop trigger if exists connector_approval_requests_tenant_integrity on connector_approval_requests;
create trigger connector_approval_requests_tenant_integrity
  before insert or update of tenant_id, connector_proposal_id on connector_approval_requests
  for each row execute function app_enforce_related_tenant('connector_proposals', 'connector_proposal_id');
drop trigger if exists private_connect_store_tenant_integrity on private_connect_store_entries;
create trigger private_connect_store_tenant_integrity
  before insert or update of tenant_id, connector_proposal_id on private_connect_store_entries
  for each row execute function app_enforce_related_tenant('connector_proposals', 'connector_proposal_id');
`;

const phase3ApiChangeMonitorMigrationSql = `
alter table api_source_snapshots
  drop constraint if exists api_source_snapshots_source_id_content_hash_key;

create table if not exists api_change_events (
  id text primary key,
  api_product_id text not null references api_products(id) on delete cascade,
  source_id text not null references api_sources(id) on delete cascade,
  previous_snapshot_id text not null references api_source_snapshots(id) on delete cascade,
  current_snapshot_id text not null references api_source_snapshots(id) on delete cascade,
  primary_classification text not null,
  classifications text not null,
  summary text not null,
  requires_approval integer not null default 0,
  detected_at text not null,
  created_at text not null,
  unique (previous_snapshot_id, current_snapshot_id)
);

create table if not exists api_change_impacts (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  api_change_event_id text not null references api_change_events(id) on delete cascade,
  connector_proposal_id text not null references connector_proposals(id) on delete cascade,
  contract_run_id text references connector_contract_runs(id) on delete set null,
  status text not null,
  upgrade_blocked integer not null default 1,
  repair_proposal text not null,
  contract_test_status text not null,
  contract_test_results text not null,
  approval_status text not null,
  decided_by text references users(id),
  decision_reason text,
  decided_at text,
  created_at text not null,
  updated_at text not null,
  unique (api_change_event_id, connector_proposal_id)
);

create index if not exists idx_api_change_events_product
  on api_change_events(api_product_id, detected_at desc);
create index if not exists idx_api_change_impacts_tenant
  on api_change_impacts(tenant_id, status, created_at desc);
create index if not exists idx_api_change_impacts_proposal
  on api_change_impacts(connector_proposal_id, created_at desc);
`;

const phase3ApiChangeMonitorRlsMigrationSql = `
alter table api_change_impacts enable row level security;

drop policy if exists tenant_isolation on api_change_impacts;
create policy tenant_isolation on api_change_impacts
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop trigger if exists api_change_impacts_tenant_integrity on api_change_impacts;
create trigger api_change_impacts_tenant_integrity
  before insert or update of tenant_id, connector_proposal_id on api_change_impacts
  for each row execute function app_enforce_related_tenant('connector_proposals', 'connector_proposal_id');


create or replace function app_enforce_api_change_event_integrity()
returns trigger language plpgsql as $$
declare
  source_product_id text;
  previous_source_id text;
  current_source_id text;
begin
  select api_product_id into source_product_id
    from api_sources where id = new.source_id;
  select source_id into previous_source_id
    from api_source_snapshots where id = new.previous_snapshot_id;
  select source_id into current_source_id
    from api_source_snapshots where id = new.current_snapshot_id;

  if source_product_id is null
     or source_product_id <> new.api_product_id
     or previous_source_id <> new.source_id
     or current_source_id <> new.source_id then
    raise exception 'Invalid API change event relation';
  end if;
  return new;
end;
$$;

drop trigger if exists api_change_events_relation_integrity on api_change_events;
create trigger api_change_events_relation_integrity
  before insert or update of api_product_id, source_id, previous_snapshot_id, current_snapshot_id
  on api_change_events
  for each row execute function app_enforce_api_change_event_integrity();

create or replace function app_enforce_api_change_impact_product()
returns trigger language plpgsql as $$
declare
  event_product_id text;
  proposal_product_id text;
begin
  select api_product_id into event_product_id
    from api_change_events where id = new.api_change_event_id;
  select api_product_id into proposal_product_id
    from connector_proposals where id = new.connector_proposal_id;

  if event_product_id is null
     or proposal_product_id is null
     or event_product_id <> proposal_product_id then
    raise exception 'Invalid API change impact relation';
  end if;
  return new;
end;
$$;

drop trigger if exists api_change_impacts_product_integrity on api_change_impacts;
create trigger api_change_impacts_product_integrity
  before insert or update of api_change_event_id, connector_proposal_id
  on api_change_impacts
  for each row execute function app_enforce_api_change_impact_product();

`;

const phase3ApiSourceRechecksMigrationSql = `
create table if not exists api_source_recheck_schedules (
  id text primary key,
  source_id text not null unique references api_sources(id) on delete cascade,
  context_tenant_id text not null references tenants(id) on delete cascade,
  configured_by text not null references users(id),
  enabled integer not null default 1 check (enabled in (0, 1)),
  interval_seconds integer not null
    check (interval_seconds between 900 and 2592000),
  next_run_at text not null,
  processing_started_at text,
  lease_id text,
  last_run_at text,
  last_success_at text,
  last_status text not null check (
    last_status in (
      'scheduled', 'processing', 'succeeded', 'retrying', 'blocked', 'disabled'
    )
  ),
  consecutive_failures integer not null default 0
    check (consecutive_failures >= 0),
  last_error_code text check (
    last_error_code is null or char_length(last_error_code) <= 80
  ),
  created_at text not null,
  updated_at text not null,
  check (
    (processing_started_at is null and lease_id is null)
    or (processing_started_at is not null and lease_id is not null)
  )
);

create index if not exists idx_api_source_rechecks_due
  on api_source_recheck_schedules(enabled, next_run_at);

create index if not exists idx_api_source_rechecks_context
  on api_source_recheck_schedules(context_tenant_id, updated_at desc);
`;

const phase3ApiDiscoveryCandidatesMigrationSql = `
create unique index if not exists uq_software_domains_id_software
  on software_domains(id, software_id);

create table if not exists api_discovery_candidates (
  id text primary key,
  software_id text not null references software_directory_entries(id) on delete cascade,
  domain_id text not null,
  canonical_url text not null unique check (char_length(canonical_url) <= 2048),
  source_type text not null check (char_length(source_type) <= 80),
  confidence integer not null check (confidence between 0 and 100),
  discovery_reason text not null check (char_length(discovery_reason) <= 240),
  sitemap_url text not null check (char_length(sitemap_url) <= 2048),
  parser_version text not null check (char_length(parser_version) <= 80),
  status text not null check (status in ('under_review', 'accepted', 'rejected')),
  api_source_id text references api_sources(id) on delete set null,
  discovered_at text not null,
  last_seen_at text not null,
  decided_by text references users(id),
  decided_at text,
  decision_reason text check (
    decision_reason is null or char_length(decision_reason) <= 500
  ),
  created_at text not null,
  updated_at text not null,
  foreign key (domain_id, software_id)
    references software_domains(id, software_id) on delete cascade,
  check (
    (status = 'under_review' and decided_by is null and decided_at is null
      and api_source_id is null)
    or (status = 'accepted' and decided_by is not null and decided_at is not null
      and api_source_id is not null)
    or (status = 'rejected' and decided_by is not null and decided_at is not null
      and api_source_id is null)
  )
);

create index if not exists idx_api_discovery_candidates_review
  on api_discovery_candidates(status, confidence desc, last_seen_at desc);

create index if not exists idx_api_discovery_candidates_domain
  on api_discovery_candidates(domain_id, last_seen_at desc);
`;

const phase3ConnectorRepairsMigrationSql = `
create table if not exists connector_repair_proposals (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  api_change_impact_id text not null unique
    references api_change_impacts(id) on delete cascade,
  source_connector_proposal_id text not null
    references connector_proposals(id) on delete cascade,
  replacement_connector_proposal_id text not null unique
    references connector_proposals(id) on delete cascade,
  source_snapshot_id text not null
    references api_source_snapshots(id) on delete cascade,
  generation_summary text not null,
  created_by text not null references users(id),
  created_at text not null,
  check (source_connector_proposal_id <> replacement_connector_proposal_id)
);

create index if not exists idx_connector_repairs_tenant
  on connector_repair_proposals(tenant_id, created_at desc);
`;

const phase3ConnectorRepairsRlsMigrationSql = `
alter table connector_repair_proposals enable row level security;

drop policy if exists tenant_isolation on connector_repair_proposals;
create policy tenant_isolation on connector_repair_proposals
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop trigger if exists connector_repairs_impact_tenant_integrity
  on connector_repair_proposals;
create trigger connector_repairs_impact_tenant_integrity
  before insert or update of tenant_id, api_change_impact_id
  on connector_repair_proposals
  for each row execute function app_enforce_related_tenant(
    'api_change_impacts', 'api_change_impact_id'
  );

drop trigger if exists connector_repairs_source_tenant_integrity
  on connector_repair_proposals;
create trigger connector_repairs_source_tenant_integrity
  before insert or update of tenant_id, source_connector_proposal_id
  on connector_repair_proposals
  for each row execute function app_enforce_related_tenant(
    'connector_proposals', 'source_connector_proposal_id'
  );

drop trigger if exists connector_repairs_replacement_tenant_integrity
  on connector_repair_proposals;
create trigger connector_repairs_replacement_tenant_integrity
  before insert or update of tenant_id, replacement_connector_proposal_id
  on connector_repair_proposals
  for each row execute function app_enforce_related_tenant(
    'connector_proposals', 'replacement_connector_proposal_id'
  );

create or replace function app_enforce_connector_repair_integrity()
returns trigger language plpgsql as $$
declare
  expected_snapshot_id text;
  impact_product_id text;
  source_product_id text;
  replacement_product_id text;
begin
  select api_change_events.current_snapshot_id,
         api_change_events.api_product_id
    into expected_snapshot_id, impact_product_id
    from api_change_impacts
    join api_change_events
      on api_change_events.id = api_change_impacts.api_change_event_id
   where api_change_impacts.id = new.api_change_impact_id;
  select api_product_id into source_product_id
    from connector_proposals where id = new.source_connector_proposal_id;
  select api_product_id into replacement_product_id
    from connector_proposals where id = new.replacement_connector_proposal_id;

  if expected_snapshot_id is null
     or expected_snapshot_id <> new.source_snapshot_id
     or impact_product_id <> source_product_id
     or impact_product_id <> replacement_product_id then
    raise exception 'Invalid connector repair relation';
  end if;
  return new;
end;
$$;

drop trigger if exists connector_repairs_relation_integrity
  on connector_repair_proposals;
create trigger connector_repairs_relation_integrity
  before insert or update of api_change_impact_id,
    source_connector_proposal_id, replacement_connector_proposal_id,
    source_snapshot_id
  on connector_repair_proposals
  for each row execute function app_enforce_connector_repair_integrity();
`;

const phase3VersionedApiImportsMigrationSql = `
alter table api_operations
  drop constraint if exists api_operations_api_product_id_operation_key_key;

create unique index if not exists uq_api_operations_product_snapshot_key
  on api_operations(api_product_id, source_snapshot_id, operation_key);
`;

const phase3ReusableMappingIntelligenceMigrationSql = `
alter table api_global_mappings
  add column if not exists promotion_reason text;

create unique index if not exists uq_api_global_mapping_shape
  on api_global_mappings(
    api_product_id,
    source_entity,
    canonical_entity,
    coalesce(source_field, ''),
    coalesce(canonical_field, '')
  );
`;

const phase4BusinessBrainMigrationSql = `
create table if not exists business_brain_entries (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  entry_key text not null,
  domain text not null check (domain in (
    'company', 'customers', 'suppliers', 'catalog', 'pricing', 'margins',
    'objectives', 'kpis', 'team', 'locations', 'automations', 'websites',
    'api', 'connectors'
  )),
  title text not null check (char_length(title) between 3 and 120),
  summary text not null check (char_length(summary) between 5 and 1000),
  details text not null check (char_length(details) <= 5000),
  source_type text not null check (source_type in (
    'manual', 'business_twin', 'crm', 'workflow', 'website', 'connector',
    'api_intelligence', 'import'
  )),
  source_ref text check (source_ref is null or char_length(source_ref) <= 500),
  confidence integer not null check (confidence between 0 and 100),
  status text not null check (status in ('active', 'superseded', 'archived')),
  version integer not null check (version > 0),
  supersedes_id text,
  created_by text not null references users(id),
  reviewed_by text references users(id),
  reviewed_at text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, entry_key, version),
  foreign key (tenant_id, supersedes_id)
    references business_brain_entries(tenant_id, id) on delete restrict,
  check (
    (reviewed_by is null and reviewed_at is null)
    or (reviewed_by is not null and reviewed_at is not null)
  )
);

create table if not exists business_brain_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  entry_id text not null,
  evidence_type text not null check (evidence_type in (
    'observation', 'document', 'system_record', 'import'
  )),
  source_ref text check (source_ref is null or char_length(source_ref) <= 500),
  summary text not null check (char_length(summary) between 5 and 500),
  captured_at text not null,
  created_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, entry_id)
    references business_brain_entries(tenant_id, id) on delete cascade
);

create index if not exists idx_business_brain_entries_tenant_status
  on business_brain_entries(tenant_id, status, domain, updated_at desc);

create index if not exists idx_business_brain_entries_tenant_key
  on business_brain_entries(tenant_id, entry_key, version desc);

create index if not exists idx_business_brain_evidence_tenant_entry
  on business_brain_evidence(tenant_id, entry_id, captured_at desc);
`;

const phase4BusinessBrainRlsMigrationSql = `
alter table business_brain_entries enable row level security;
alter table business_brain_evidence enable row level security;

drop policy if exists tenant_isolation on business_brain_entries;
create policy tenant_isolation on business_brain_entries
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on business_brain_evidence;
create policy tenant_isolation on business_brain_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
`;

const phase4StrategicAdvisorMigrationSql = `
create table if not exists strategic_recommendations (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  rule_key text not null check (char_length(rule_key) between 3 and 160),
  fingerprint text not null check (char_length(fingerprint) = 64),
  advisor_role text not null check (advisor_role in (
    'executive', 'marketing', 'sales', 'operations', 'finance',
    'reputation', 'technology'
  )),
  title text not null check (char_length(title) between 5 and 160),
  rationale text not null check (char_length(rationale) between 10 and 1200),
  expected_gain text not null check (char_length(expected_gain) between 5 and 500),
  effort text not null check (effort in ('low', 'medium', 'high')),
  roi_summary text not null check (char_length(roi_summary) between 5 and 500),
  risk_summary text not null check (char_length(risk_summary) between 5 and 500),
  confidence integer not null check (confidence between 0 and 100),
  action_label text not null check (char_length(action_label) between 3 and 80),
  action_href text not null check (
    char_length(action_href) between 1 and 300 and substr(action_href, 1, 1) = '/'
  ),
  status text not null check (status in (
    'proposed', 'approved', 'rejected', 'superseded', 'expired'
  )),
  generation_version text not null check (char_length(generation_version) <= 80),
  created_by text not null references users(id),
  decided_by text references users(id),
  decision_reason text check (
    decision_reason is null or char_length(decision_reason) <= 500
  ),
  decided_at text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, rule_key, fingerprint),
  check (
    (status in ('proposed', 'superseded', 'expired') and decided_by is null
      and decision_reason is null and decided_at is null)
    or (status in ('approved', 'rejected') and decided_by is not null
      and decision_reason is not null and decided_at is not null)
  )
);

create table if not exists strategic_recommendation_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  recommendation_id text not null,
  evidence_type text not null check (evidence_type in (
    'business_brain_entry', 'system_metric', 'audit_record', 'api_source'
  )),
  evidence_ref text not null check (char_length(evidence_ref) between 1 and 300),
  label text not null check (char_length(label) between 3 and 160),
  observed_value text not null check (char_length(observed_value) between 1 and 500),
  captured_at text not null,
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, recommendation_id)
    references strategic_recommendations(tenant_id, id) on delete cascade
);

create table if not exists strategic_recommendation_decisions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  recommendation_id text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text not null check (char_length(reason) between 5 and 500),
  decided_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, recommendation_id)
    references strategic_recommendations(tenant_id, id) on delete cascade
);

create index if not exists idx_strategic_recommendations_tenant_status
  on strategic_recommendations(tenant_id, status, created_at desc);

create index if not exists idx_strategic_recommendations_tenant_role
  on strategic_recommendations(tenant_id, advisor_role, updated_at desc);

create index if not exists idx_strategic_evidence_tenant_recommendation
  on strategic_recommendation_evidence(
    tenant_id, recommendation_id, captured_at desc
  );

create index if not exists idx_strategic_decisions_tenant_recommendation
  on strategic_recommendation_decisions(
    tenant_id, recommendation_id, created_at desc
  );
`;

const phase4StrategicAdvisorRlsMigrationSql = `
alter table strategic_recommendations enable row level security;
alter table strategic_recommendation_evidence enable row level security;
alter table strategic_recommendation_decisions enable row level security;

drop policy if exists tenant_isolation on strategic_recommendations;
create policy tenant_isolation on strategic_recommendations
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on strategic_recommendation_evidence;
create policy tenant_isolation on strategic_recommendation_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on strategic_recommendation_decisions;
create policy tenant_isolation on strategic_recommendation_decisions
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
`;

const phase4AutonomousMarketingMigrationSql = `
create table if not exists marketing_campaign_proposals (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  campaign_key text not null check (char_length(campaign_key) between 3 and 160),
  fingerprint text not null check (char_length(fingerprint) = 64),
  channel text not null check (channel in ('email', 'social', 'website')),
  title text not null check (char_length(title) between 5 and 160),
  subject text not null check (char_length(subject) <= 200),
  objective text not null check (char_length(objective) between 5 and 500),
  audience text not null check (char_length(audience) between 3 and 500),
  content text not null check (char_length(content) between 10 and 5000),
  call_to_action text not null check (char_length(call_to_action) between 2 and 80),
  expected_outcome text not null check (
    char_length(expected_outcome) between 5 and 500
  ),
  risk_summary text not null check (char_length(risk_summary) between 5 and 500),
  budget_cents integer check (budget_cents is null or budget_cents >= 0),
  starts_at text,
  ends_at text,
  status text not null check (status in (
    'draft', 'pending_approval', 'approved', 'rejected', 'superseded', 'archived'
  )),
  version integer not null check (version > 0),
  supersedes_id text,
  source_strategy_recommendation_id text,
  generation_version text not null check (char_length(generation_version) <= 80),
  created_by text not null references users(id),
  decided_by text references users(id),
  decision_reason text check (
    decision_reason is null or char_length(decision_reason) <= 500
  ),
  decided_at text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, campaign_key, version),
  unique (tenant_id, campaign_key, fingerprint),
  foreign key (tenant_id, supersedes_id)
    references marketing_campaign_proposals(tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_strategy_recommendation_id)
    references strategic_recommendations(tenant_id, id) on delete restrict,
  check (starts_at is null or ends_at is null or starts_at < ends_at),
  check (
    (status in ('draft', 'pending_approval', 'superseded', 'archived')
      and decided_by is null and decision_reason is null and decided_at is null)
    or (status in ('approved', 'rejected') and decided_by is not null
      and decision_reason is not null and decided_at is not null)
  )
);

create table if not exists marketing_campaign_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  proposal_id text not null,
  evidence_type text not null check (evidence_type in (
    'business_profile', 'business_brain_entry', 'strategic_recommendation'
  )),
  evidence_ref text not null check (char_length(evidence_ref) between 1 and 300),
  label text not null check (char_length(label) between 3 and 160),
  observed_value text not null check (char_length(observed_value) between 1 and 500),
  captured_at text not null,
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, proposal_id)
    references marketing_campaign_proposals(tenant_id, id) on delete cascade
);

create table if not exists marketing_campaign_decisions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  proposal_id text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text not null check (char_length(reason) between 5 and 500),
  decided_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, proposal_id)
    references marketing_campaign_proposals(tenant_id, id) on delete cascade
);

create index if not exists idx_marketing_proposals_tenant_status
  on marketing_campaign_proposals(tenant_id, status, updated_at desc);

create index if not exists idx_marketing_proposals_tenant_campaign
  on marketing_campaign_proposals(tenant_id, campaign_key, version desc);

create index if not exists idx_marketing_evidence_tenant_proposal
  on marketing_campaign_evidence(tenant_id, proposal_id, captured_at desc);

create index if not exists idx_marketing_decisions_tenant_proposal
  on marketing_campaign_decisions(tenant_id, proposal_id, created_at desc);
`;

const phase4AutonomousMarketingRlsMigrationSql = `
alter table marketing_campaign_proposals enable row level security;
alter table marketing_campaign_evidence enable row level security;
alter table marketing_campaign_decisions enable row level security;

drop policy if exists tenant_isolation on marketing_campaign_proposals;
create policy tenant_isolation on marketing_campaign_proposals
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on marketing_campaign_evidence;
create policy tenant_isolation on marketing_campaign_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on marketing_campaign_decisions;
create policy tenant_isolation on marketing_campaign_decisions
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
`;

const phase4WebsiteAiMigrationSql = `
create unique index if not exists uq_websites_tenant_id
  on websites(tenant_id, id);

create unique index if not exists uq_website_sections_tenant_website_id
  on website_sections(tenant_id, website_id, id);

create table if not exists website_ai_proposals (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  website_id text not null,
  section_id text not null,
  proposal_key text not null check (char_length(proposal_key) between 3 and 160),
  fingerprint text not null check (char_length(fingerprint) = 64),
  proposal_type text not null check (proposal_type in (
    'seo_copy', 'faq_content', 'accessibility_copy'
  )),
  title text not null check (char_length(title) between 5 and 160),
  rationale text not null check (char_length(rationale) between 10 and 1000),
  expected_gain text not null check (char_length(expected_gain) between 5 and 500),
  risk_summary text not null check (char_length(risk_summary) between 5 and 500),
  proposed_title text not null check (char_length(proposed_title) between 1 and 300),
  proposed_body text not null check (char_length(proposed_body) between 1 and 5000),
  original_content_hash text not null check (char_length(original_content_hash) = 64),
  status text not null check (status in (
    'proposed', 'pending_approval', 'approved', 'rejected', 'applied',
    'superseded', 'stale'
  )),
  version integer not null check (version > 0),
  supersedes_id text,
  generation_version text not null check (char_length(generation_version) <= 80),
  created_by text not null references users(id),
  decided_by text references users(id),
  decision_reason text check (
    decision_reason is null or char_length(decision_reason) <= 500
  ),
  decided_at text,
  applied_by text references users(id),
  applied_at text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, proposal_key, fingerprint),
  foreign key (tenant_id, website_id)
    references websites(tenant_id, id) on delete cascade,
  foreign key (tenant_id, website_id, section_id)
    references website_sections(tenant_id, website_id, id) on delete cascade,
  foreign key (tenant_id, supersedes_id)
    references website_ai_proposals(tenant_id, id) on delete restrict,
  check (
    (status in ('proposed', 'pending_approval', 'superseded', 'stale')
      and decided_by is null and decision_reason is null and decided_at is null)
    or (status in ('approved', 'rejected', 'applied')
      and decided_by is not null and decision_reason is not null and decided_at is not null)
  ),
  check (
    (status = 'applied' and applied_by is not null and applied_at is not null)
    or (status <> 'applied' and applied_by is null and applied_at is null)
  )
);

create table if not exists website_ai_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  proposal_id text not null,
  evidence_type text not null check (evidence_type in (
    'business_profile', 'website_section'
  )),
  evidence_ref text not null check (char_length(evidence_ref) between 1 and 300),
  label text not null check (char_length(label) between 3 and 160),
  observed_value text not null check (char_length(observed_value) between 1 and 500),
  captured_at text not null,
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, proposal_id)
    references website_ai_proposals(tenant_id, id) on delete cascade
);

create table if not exists website_ai_decisions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  proposal_id text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text not null check (char_length(reason) between 5 and 500),
  decided_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, proposal_id)
    references website_ai_proposals(tenant_id, id) on delete cascade
);

create index if not exists idx_website_ai_proposals_tenant_status
  on website_ai_proposals(tenant_id, status, updated_at desc);

create index if not exists idx_website_ai_proposals_tenant_website
  on website_ai_proposals(tenant_id, website_id, proposal_key);

create index if not exists idx_website_ai_evidence_tenant_proposal
  on website_ai_evidence(tenant_id, proposal_id, captured_at desc);

create index if not exists idx_website_ai_decisions_tenant_proposal
  on website_ai_decisions(tenant_id, proposal_id, created_at desc);
`;

const phase4WebsiteAiRlsMigrationSql = `
alter table website_ai_proposals enable row level security;
alter table website_ai_evidence enable row level security;
alter table website_ai_decisions enable row level security;

drop policy if exists tenant_isolation on website_ai_proposals;
create policy tenant_isolation on website_ai_proposals
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on website_ai_evidence;
create policy tenant_isolation on website_ai_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on website_ai_decisions;
create policy tenant_isolation on website_ai_decisions
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

`;

const phase4SalesAiMigrationSql = `
create unique index if not exists uq_opportunities_tenant_id
  on opportunities(tenant_id, id);

create table if not exists sales_ai_assessments (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  opportunity_id text not null,
  fingerprint text not null check (char_length(fingerprint) = 64),
  status text not null check (status in ('current', 'superseded')),
  score integer not null check (score between 0 and 100),
  closing_estimate integer not null check (closing_estimate between 0 and 100),
  confidence integer not null check (confidence between 0 and 100),
  priority text not null check (priority in ('low', 'medium', 'high')),
  title text not null check (char_length(title) between 5 and 160),
  rationale text not null check (char_length(rationale) between 10 and 1200),
  recommended_action text not null check (
    char_length(recommended_action) between 5 and 500
  ),
  risk_summary text not null check (char_length(risk_summary) between 5 and 500),
  action_label text not null check (char_length(action_label) between 3 and 80),
  action_href text not null check (
    char_length(action_href) between 1 and 300 and substr(action_href, 1, 1) = '/'
  ),
  version integer not null check (version >= 1),
  supersedes_id text,
  generation_version text not null check (char_length(generation_version) <= 80),
  generated_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, opportunity_id)
    references opportunities(tenant_id, id) on delete cascade,
  foreign key (tenant_id, supersedes_id)
    references sales_ai_assessments(tenant_id, id) on delete restrict
);

create table if not exists sales_ai_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  assessment_id text not null,
  evidence_type text not null check (evidence_type in (
    'opportunity_stage', 'opportunity_value', 'follow_up',
    'recent_activity', 'open_tasks', 'assignment'
  )),
  evidence_ref text not null check (char_length(evidence_ref) between 1 and 300),
  label text not null check (char_length(label) between 3 and 160),
  observed_value text not null check (char_length(observed_value) between 1 and 500),
  captured_at text not null,
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, assessment_id)
    references sales_ai_assessments(tenant_id, id) on delete cascade
);

create index if not exists idx_sales_ai_assessments_tenant_status
  on sales_ai_assessments(tenant_id, status, priority, updated_at desc);

create index if not exists idx_sales_ai_assessments_tenant_opportunity
  on sales_ai_assessments(tenant_id, opportunity_id, version desc);

create index if not exists idx_sales_ai_assessments_tenant_fingerprint
  on sales_ai_assessments(tenant_id, opportunity_id, fingerprint);

create unique index if not exists uq_sales_ai_assessments_current
  on sales_ai_assessments(tenant_id, opportunity_id)
  where status = 'current';

create index if not exists idx_sales_ai_evidence_tenant_assessment
  on sales_ai_evidence(tenant_id, assessment_id, captured_at desc);
`;

const phase4SalesAiRlsMigrationSql = `
alter table sales_ai_assessments enable row level security;
alter table sales_ai_evidence enable row level security;

drop policy if exists tenant_isolation on sales_ai_assessments;
create policy tenant_isolation on sales_ai_assessments
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on sales_ai_evidence;
create policy tenant_isolation on sales_ai_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
`;

const phase4ReputationAiMigrationSql = `
create table if not exists reputation_reviews (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  source text not null check (source in (
    'google', 'facebook', 'instagram', 'tripadvisor', 'trustpilot',
    'industry_directory', 'direct_feedback', 'manual_import'
  )),
  external_ref text check (external_ref is null or char_length(external_ref) <= 200),
  reviewer_alias text check (
    reviewer_alias is null or char_length(reviewer_alias) <= 100
  ),
  rating integer check (rating is null or rating between 1 and 5),
  review_text text not null check (char_length(review_text) between 3 and 3000),
  content_hash text not null check (char_length(content_hash) = 64),
  occurred_at text not null,
  imported_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, content_hash)
);

create table if not exists reputation_response_proposals (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  review_id text not null,
  fingerprint text not null check (char_length(fingerprint) = 64),
  sentiment text not null check (sentiment in ('positive', 'neutral', 'negative')),
  confidence integer not null check (confidence between 0 and 100),
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  authenticity_status text not null check (authenticity_status = 'not_assessed'),
  rationale text not null check (char_length(rationale) between 10 and 1000),
  response_draft text not null check (char_length(response_draft) between 10 and 1500),
  improvement_plan text not null check (
    char_length(improvement_plan) between 10 and 1500
  ),
  status text not null check (status in (
    'proposed', 'pending_approval', 'approved', 'rejected', 'superseded'
  )),
  version integer not null check (version >= 1),
  supersedes_id text,
  generation_version text not null check (char_length(generation_version) <= 80),
  generated_by text not null references users(id),
  decided_by text references users(id),
  decision_reason text check (
    decision_reason is null or char_length(decision_reason) <= 500
  ),
  decided_at text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, review_id, fingerprint),
  foreign key (tenant_id, review_id)
    references reputation_reviews(tenant_id, id) on delete cascade,
  foreign key (tenant_id, supersedes_id)
    references reputation_response_proposals(tenant_id, id) on delete restrict,
  check (
    (status in ('proposed', 'pending_approval', 'superseded')
      and decided_by is null and decision_reason is null and decided_at is null)
    or (status in ('approved', 'rejected')
      and decided_by is not null and decision_reason is not null and decided_at is not null)
  )
);

create table if not exists reputation_proposal_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  proposal_id text not null,
  evidence_type text not null check (evidence_type in (
    'review_source', 'review_rating', 'review_text'
  )),
  evidence_ref text not null check (char_length(evidence_ref) between 1 and 300),
  label text not null check (char_length(label) between 3 and 160),
  observed_value text not null check (char_length(observed_value) between 1 and 500),
  captured_at text not null,
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, proposal_id)
    references reputation_response_proposals(tenant_id, id) on delete cascade
);

create table if not exists reputation_proposal_decisions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  proposal_id text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text not null check (char_length(reason) between 5 and 500),
  decided_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, proposal_id)
    references reputation_response_proposals(tenant_id, id) on delete cascade
);

create index if not exists idx_reputation_reviews_tenant_occurred
  on reputation_reviews(tenant_id, occurred_at desc);

create index if not exists idx_reputation_proposals_tenant_status
  on reputation_response_proposals(tenant_id, status, updated_at desc);

create index if not exists idx_reputation_proposals_tenant_review
  on reputation_response_proposals(tenant_id, review_id, version desc);

create index if not exists idx_reputation_evidence_tenant_proposal
  on reputation_proposal_evidence(tenant_id, proposal_id, captured_at desc);

create index if not exists idx_reputation_decisions_tenant_proposal
  on reputation_proposal_decisions(tenant_id, proposal_id, created_at desc);
`;

const phase4ReputationAiRlsMigrationSql = `
alter table reputation_reviews enable row level security;
alter table reputation_response_proposals enable row level security;
alter table reputation_proposal_evidence enable row level security;
alter table reputation_proposal_decisions enable row level security;

drop policy if exists tenant_isolation on reputation_reviews;
create policy tenant_isolation on reputation_reviews
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on reputation_response_proposals;
create policy tenant_isolation on reputation_response_proposals
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on reputation_proposal_evidence;
create policy tenant_isolation on reputation_proposal_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on reputation_proposal_decisions;
create policy tenant_isolation on reputation_proposal_decisions
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
`;

const phase4CompetitorIntelligenceMigrationSql = `
create table if not exists competitor_profiles (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  website_url text check (website_url is null or char_length(website_url) <= 500),
  status text not null check (status in ('active', 'archived')),
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id)
);

create unique index if not exists idx_competitor_profiles_tenant_name
  on competitor_profiles(tenant_id, lower(name));

create table if not exists competitor_observations (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  competitor_id text not null,
  category text not null check (category in (
    'price', 'website', 'seo', 'service', 'product', 'google_position',
    'advertising', 'social_activity', 'review', 'opening_hours', 'job',
    'partnership'
  )),
  direction text not null check (direction in (
    'increase', 'decrease', 'new', 'removed', 'changed',
    'positive_signal', 'negative_signal'
  )),
  source_type text not null check (source_type in (
    'official_website', 'public_search', 'public_social', 'public_directory',
    'public_ad', 'public_job', 'public_review', 'public_announcement'
  )),
  source_url text not null check (char_length(source_url) between 10 and 500),
  title text not null check (char_length(title) between 3 and 160),
  summary text not null check (char_length(summary) between 10 and 2000),
  observed_value text check (
    observed_value is null or char_length(observed_value) <= 300
  ),
  content_hash text not null check (char_length(content_hash) = 64),
  observed_at text not null,
  recorded_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, competitor_id, content_hash),
  foreign key (tenant_id, competitor_id)
    references competitor_profiles(tenant_id, id) on delete cascade
);

create table if not exists competitor_insights (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  competitor_id text not null,
  category text not null check (category in (
    'price', 'website', 'seo', 'service', 'product', 'google_position',
    'advertising', 'social_activity', 'review', 'opening_hours', 'job',
    'partnership'
  )),
  latest_observation_id text not null,
  previous_observation_id text,
  fingerprint text not null check (char_length(fingerprint) = 64),
  impact text not null check (impact in ('opportunity', 'risk', 'watch')),
  confidence integer not null check (confidence between 0 and 100),
  title text not null check (char_length(title) between 3 and 180),
  rationale text not null check (char_length(rationale) between 10 and 1200),
  recommended_action text not null check (
    char_length(recommended_action) between 10 and 1200
  ),
  status text not null check (status in (
    'proposed', 'pending_approval', 'approved', 'rejected', 'superseded'
  )),
  version integer not null check (version >= 1),
  supersedes_id text,
  generation_version text not null check (char_length(generation_version) <= 80),
  generated_by text not null references users(id),
  decided_by text references users(id),
  decision_reason text check (
    decision_reason is null or char_length(decision_reason) <= 500
  ),
  decided_at text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, competitor_id, category, fingerprint),
  foreign key (tenant_id, competitor_id)
    references competitor_profiles(tenant_id, id) on delete cascade,
  foreign key (tenant_id, latest_observation_id)
    references competitor_observations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, previous_observation_id)
    references competitor_observations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, supersedes_id)
    references competitor_insights(tenant_id, id) on delete restrict,
  check (
    (status in ('proposed', 'pending_approval', 'superseded')
      and decided_by is null and decision_reason is null and decided_at is null)
    or (status in ('approved', 'rejected')
      and decided_by is not null and decision_reason is not null and decided_at is not null)
  )
);

create table if not exists competitor_insight_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  insight_id text not null,
  observation_id text not null,
  label text not null check (char_length(label) between 3 and 160),
  observed_value text not null check (char_length(observed_value) between 1 and 500),
  captured_at text not null,
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, insight_id)
    references competitor_insights(tenant_id, id) on delete cascade,
  foreign key (tenant_id, observation_id)
    references competitor_observations(tenant_id, id) on delete restrict
);

create table if not exists competitor_insight_decisions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  insight_id text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text not null check (char_length(reason) between 5 and 500),
  decided_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, insight_id)
    references competitor_insights(tenant_id, id) on delete cascade
);

create index if not exists idx_competitor_profiles_tenant_status
  on competitor_profiles(tenant_id, status, updated_at desc);

create index if not exists idx_competitor_observations_tenant_competitor
  on competitor_observations(tenant_id, competitor_id, category, observed_at desc);

create index if not exists idx_competitor_insights_tenant_status
  on competitor_insights(tenant_id, status, updated_at desc);

create index if not exists idx_competitor_insights_tenant_competitor
  on competitor_insights(tenant_id, competitor_id, category, version desc);

create index if not exists idx_competitor_evidence_tenant_insight
  on competitor_insight_evidence(tenant_id, insight_id, captured_at desc);

create index if not exists idx_competitor_decisions_tenant_insight
  on competitor_insight_decisions(tenant_id, insight_id, created_at desc);
`;

const phase4CompetitorIntelligenceRlsMigrationSql = `
alter table competitor_profiles enable row level security;
alter table competitor_observations enable row level security;
alter table competitor_insights enable row level security;
alter table competitor_insight_evidence enable row level security;
alter table competitor_insight_decisions enable row level security;

drop policy if exists tenant_isolation on competitor_profiles;
create policy tenant_isolation on competitor_profiles
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on competitor_observations;
create policy tenant_isolation on competitor_observations
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on competitor_insights;
create policy tenant_isolation on competitor_insights
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on competitor_insight_evidence;
create policy tenant_isolation on competitor_insight_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on competitor_insight_decisions;
create policy tenant_isolation on competitor_insight_decisions
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
`;

const phase4FinancialAiMigrationSql = `
create table if not exists financial_input_snapshots (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  period_month text not null check (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text not null check (status in ('current', 'superseded')),
  version integer not null check (version >= 1),
  supersedes_id text,
  monthly_revenue_cents bigint not null check (monthly_revenue_cents >= 0),
  operating_costs_cents bigint not null check (operating_costs_cents >= 0),
  cash_balance_cents bigint not null check (cash_balance_cents >= 0),
  cash_inflows_cents bigint not null check (cash_inflows_cents >= 0),
  cash_outflows_cents bigint not null check (cash_outflows_cents >= 0),
  receivables_cents bigint not null check (receivables_cents >= 0),
  payables_cents bigint not null check (payables_cents >= 0),
  marketing_spend_cents bigint not null check (marketing_spend_cents >= 0),
  sales_spend_cents bigint not null check (sales_spend_cents >= 0),
  website_spend_cents bigint not null check (website_spend_cents >= 0),
  automation_spend_cents bigint not null check (automation_spend_cents >= 0),
  new_customers integer not null check (new_customers >= 0),
  active_customers integer not null check (active_customers >= 0),
  average_lifetime_months integer check (
    average_lifetime_months is null or average_lifetime_months between 0 and 600
  ),
  marketing_attributed_revenue_cents bigint check (
    marketing_attributed_revenue_cents is null or marketing_attributed_revenue_cents >= 0
  ),
  sales_attributed_revenue_cents bigint check (
    sales_attributed_revenue_cents is null or sales_attributed_revenue_cents >= 0
  ),
  website_attributed_revenue_cents bigint check (
    website_attributed_revenue_cents is null or website_attributed_revenue_cents >= 0
  ),
  automation_savings_cents bigint check (
    automation_savings_cents is null or automation_savings_cents >= 0
  ),
  evidence_summary text not null check (char_length(evidence_summary) between 10 and 500),
  recorded_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, period_month, version),
  foreign key (tenant_id, supersedes_id)
    references financial_input_snapshots(tenant_id, id) on delete restrict
);

create unique index if not exists idx_financial_snapshots_current_period
  on financial_input_snapshots(tenant_id, period_month)
  where status = 'current';

create table if not exists financial_assessments (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  snapshot_id text not null,
  period_month text not null check (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  fingerprint text not null check (char_length(fingerprint) = 64),
  status text not null check (status in ('current', 'superseded')),
  version integer not null check (version >= 1),
  supersedes_id text,
  monthly_revenue_cents bigint not null check (monthly_revenue_cents >= 0),
  estimated_profit_cents bigint not null,
  margin_basis_points integer,
  cash_flow_cents bigint not null,
  cash_runway_months integer check (
    cash_runway_months is null or cash_runway_months >= 0
  ),
  customer_lifetime_value_cents bigint check (
    customer_lifetime_value_cents is null or customer_lifetime_value_cents >= 0
  ),
  customer_acquisition_cost_cents bigint check (
    customer_acquisition_cost_cents is null or customer_acquisition_cost_cents >= 0
  ),
  marketing_roi_basis_points integer,
  sales_roi_basis_points integer,
  website_roi_basis_points integer,
  automation_roi_basis_points integer,
  pipeline_value_cents bigint not null check (pipeline_value_cents >= 0),
  weighted_pipeline_value_cents bigint not null check (weighted_pipeline_value_cents >= 0),
  forecast_three_months_cents bigint not null check (forecast_three_months_cents >= 0),
  confidence integer not null check (confidence between 0 and 100),
  rationale text not null check (char_length(rationale) between 20 and 2000),
  limitations text not null check (char_length(limitations) between 20 and 2000),
  recommended_action text not null check (
    char_length(recommended_action) between 20 and 1200
  ),
  generation_version text not null check (char_length(generation_version) <= 80),
  generated_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, fingerprint),
  unique (tenant_id, period_month, version),
  foreign key (tenant_id, snapshot_id)
    references financial_input_snapshots(tenant_id, id) on delete restrict,
  foreign key (tenant_id, supersedes_id)
    references financial_assessments(tenant_id, id) on delete restrict
);

create unique index if not exists idx_financial_assessments_current_period
  on financial_assessments(tenant_id, period_month)
  where status = 'current';

create table if not exists financial_assessment_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  assessment_id text not null,
  evidence_type text not null check (evidence_type in (
    'declared_input', 'crm_pipeline', 'business_brain', 'formula'
  )),
  source_ref text not null check (char_length(source_ref) between 1 and 200),
  label text not null check (char_length(label) between 3 and 160),
  observed_value text not null check (char_length(observed_value) between 1 and 600),
  captured_at text not null,
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, assessment_id)
    references financial_assessments(tenant_id, id) on delete cascade
);

create table if not exists financial_alerts (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  assessment_id text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  code text not null check (char_length(code) between 3 and 80),
  title text not null check (char_length(title) between 5 and 180),
  explanation text not null check (char_length(explanation) between 20 and 1000),
  action_label text not null check (char_length(action_label) between 3 and 120),
  action_href text not null check (char_length(action_href) between 1 and 300),
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, assessment_id, code),
  foreign key (tenant_id, assessment_id)
    references financial_assessments(tenant_id, id) on delete cascade
);

create index if not exists idx_financial_snapshots_tenant_period
  on financial_input_snapshots(tenant_id, period_month desc, version desc);

create index if not exists idx_financial_assessments_tenant_period
  on financial_assessments(tenant_id, period_month desc, version desc);

create index if not exists idx_financial_evidence_tenant_assessment
  on financial_assessment_evidence(tenant_id, assessment_id, captured_at desc);

create index if not exists idx_financial_alerts_tenant_assessment
  on financial_alerts(tenant_id, assessment_id, severity, created_at desc);
`;

const phase4FinancialAiRlsMigrationSql = `
alter table financial_input_snapshots enable row level security;
alter table financial_assessments enable row level security;
alter table financial_assessment_evidence enable row level security;
alter table financial_alerts enable row level security;

drop policy if exists tenant_isolation on financial_input_snapshots;
create policy tenant_isolation on financial_input_snapshots
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on financial_assessments;
create policy tenant_isolation on financial_assessments
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on financial_assessment_evidence;
create policy tenant_isolation on financial_assessment_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on financial_alerts;
create policy tenant_isolation on financial_alerts
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
`;

const phase4AiEmployeesMigrationSql = `
create table if not exists ai_employee_profiles (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  employee_key text not null check (char_length(employee_key) between 3 and 80),
  role_key text not null check (role_key in (
    'marketing_manager', 'sales_assistant', 'receptionist', 'customer_support',
    'seo_specialist', 'content_writer', 'business_analyst',
    'automation_engineer', 'website_manager'
  )),
  display_name text not null check (char_length(display_name) between 3 and 100),
  purpose text not null check (char_length(purpose) between 10 and 500),
  operational_status text not null check (operational_status in ('enabled', 'paused')),
  record_status text not null check (record_status in ('current', 'superseded')),
  skills text not null check (char_length(skills) between 2 and 8000),
  memory_domains text not null check (char_length(memory_domains) between 2 and 2000),
  permissions text not null check (char_length(permissions) between 2 and 8000),
  working_hours text not null check (char_length(working_hours) between 2 and 2000),
  tools text not null check (char_length(tools) between 2 and 8000),
  approval_limits text not null check (char_length(approval_limits) between 2 and 4000),
  kpis text not null check (char_length(kpis) between 2 and 8000),
  version integer not null check (version >= 1),
  supersedes_id text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, employee_key, version),
  foreign key (tenant_id, supersedes_id)
    references ai_employee_profiles(tenant_id, id) on delete restrict
);

create unique index if not exists idx_ai_employee_profiles_current
  on ai_employee_profiles(tenant_id, employee_key)
  where record_status = 'current';

create table if not exists ai_employee_activity_logs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  employee_key text not null check (char_length(employee_key) between 3 and 80),
  profile_id text not null,
  activity_type text not null check (activity_type in (
    'provisioned', 'initialized', 'profile_revised', 'paused', 'resumed'
  )),
  summary text not null check (char_length(summary) between 10 and 500),
  safe_metadata text not null check (char_length(safe_metadata) between 2 and 4000),
  actor_id text references users(id),
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, profile_id)
    references ai_employee_profiles(tenant_id, id) on delete restrict
);

create index if not exists idx_ai_employee_profiles_tenant_status
  on ai_employee_profiles(tenant_id, record_status, operational_status, role_key);

create index if not exists idx_ai_employee_activity_tenant_employee
  on ai_employee_activity_logs(tenant_id, employee_key, created_at desc);

create index if not exists idx_ai_employee_activity_tenant_profile
  on ai_employee_activity_logs(tenant_id, profile_id, created_at desc);
`;

const phase4AiEmployeesRlsMigrationSql = `
alter table ai_employee_profiles enable row level security;
alter table ai_employee_activity_logs enable row level security;

drop policy if exists tenant_isolation on ai_employee_profiles;
create policy tenant_isolation on ai_employee_profiles
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on ai_employee_activity_logs;
create policy tenant_isolation on ai_employee_activity_logs
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
`;

const phase4UniversalConnectorsMigrationSql = `
create unique index if not exists uq_private_connect_store_tenant_id
  on private_connect_store_entries(tenant_id, id);

create unique index if not exists uq_connector_proposals_tenant_id
  on connector_proposals(tenant_id, id);

create table if not exists connector_installation_plans (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  store_entry_id text not null,
  connector_proposal_id text not null,
  fingerprint text not null check (char_length(fingerprint) = 64),
  record_status text not null check (record_status in ('current', 'superseded')),
  enabled integer not null default 0 check (enabled = 0),
  installation_mode text not null check (installation_mode = 'sandbox_only'),
  tenant_industry text not null check (char_length(tenant_industry) between 1 and 160),
  industry_match text not null check (industry_match in ('aligned', 'not_documented')),
  capabilities_snapshot text not null check (char_length(capabilities_snapshot) between 2 and 12000),
  evidence_summary text not null check (char_length(evidence_summary) between 2 and 8000),
  blockers text not null check (char_length(blockers) between 2 and 4000),
  version integer not null check (version >= 1),
  supersedes_id text,
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, store_entry_id, version),
  foreign key (tenant_id, store_entry_id)
    references private_connect_store_entries(tenant_id, id) on delete restrict,
  foreign key (tenant_id, connector_proposal_id)
    references connector_proposals(tenant_id, id) on delete restrict,
  foreign key (tenant_id, supersedes_id)
    references connector_installation_plans(tenant_id, id) on delete restrict
);

create unique index if not exists idx_connector_installation_plans_current
  on connector_installation_plans(tenant_id, store_entry_id)
  where record_status = 'current';

create index if not exists idx_connector_installation_plans_tenant_status
  on connector_installation_plans(tenant_id, record_status, updated_at desc);

create index if not exists idx_connector_installation_plans_tenant_proposal
  on connector_installation_plans(tenant_id, connector_proposal_id, version desc);
`;

const phase4UniversalConnectorsRlsMigrationSql = `
alter table connector_installation_plans enable row level security;

drop policy if exists tenant_isolation on connector_installation_plans;
create policy tenant_isolation on connector_installation_plans
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
`;

const phase4PrivateAppMarketplaceMigrationSql = `
create unique index if not exists uq_workflows_tenant_id
  on workflows(tenant_id, id);

create table if not exists private_marketplace_listings (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  listing_key text not null check (char_length(listing_key) between 3 and 200),
  category text not null check (category in ('connector', 'workflow', 'ai_employee')),
  source_kind text not null check (source_kind in ('connector_plan', 'workflow', 'ai_employee_profile')),
  connector_plan_id text,
  workflow_id text,
  ai_employee_profile_id text,
  title text not null check (char_length(title) between 3 and 160),
  summary text not null check (char_length(summary) between 10 and 800),
  fingerprint text not null check (char_length(fingerprint) = 64),
  record_status text not null check (record_status in ('current', 'superseded')),
  visibility text not null default 'private' check (visibility = 'private'),
  capabilities_snapshot text not null check (char_length(capabilities_snapshot) between 2 and 12000),
  permissions_snapshot text not null check (char_length(permissions_snapshot) between 2 and 12000),
  provenance_snapshot text not null check (char_length(provenance_snapshot) between 2 and 8000),
  version integer not null check (version >= 1),
  supersedes_id text,
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, listing_key, version),
  check (
    (source_kind = 'connector_plan' and connector_plan_id is not null and workflow_id is null and ai_employee_profile_id is null)
    or (source_kind = 'workflow' and connector_plan_id is null and workflow_id is not null and ai_employee_profile_id is null)
    or (source_kind = 'ai_employee_profile' and connector_plan_id is null and workflow_id is null and ai_employee_profile_id is not null)
  ),
  foreign key (tenant_id, connector_plan_id)
    references connector_installation_plans(tenant_id, id) on delete restrict,
  foreign key (tenant_id, workflow_id)
    references workflows(tenant_id, id) on delete restrict,
  foreign key (tenant_id, ai_employee_profile_id)
    references ai_employee_profiles(tenant_id, id) on delete restrict,
  foreign key (tenant_id, supersedes_id)
    references private_marketplace_listings(tenant_id, id) on delete restrict
);

create unique index if not exists idx_private_marketplace_listings_current
  on private_marketplace_listings(tenant_id, listing_key)
  where record_status = 'current';

create index if not exists idx_private_marketplace_listings_tenant_category
  on private_marketplace_listings(tenant_id, category, record_status, updated_at desc);

create table if not exists marketplace_installation_previews (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  listing_id text not null,
  listing_version integer not null check (listing_version >= 1),
  listing_fingerprint text not null check (char_length(listing_fingerprint) = 64),
  status text not null default 'ready' check (status = 'ready'),
  installation_mode text not null default 'preview_only' check (installation_mode = 'preview_only'),
  enabled integer not null default 0 check (enabled = 0),
  installation_steps text not null check (char_length(installation_steps) between 2 and 8000),
  permission_review text not null check (char_length(permission_review) between 2 and 8000),
  blockers text not null check (char_length(blockers) between 2 and 4000),
  created_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, listing_id, listing_version),
  foreign key (tenant_id, listing_id)
    references private_marketplace_listings(tenant_id, id) on delete restrict
);

create index if not exists idx_marketplace_previews_tenant_listing
  on marketplace_installation_previews(tenant_id, listing_id, created_at desc);
`;

const phase4PrivateAppMarketplaceRlsMigrationSql = `
alter table private_marketplace_listings enable row level security;
alter table marketplace_installation_previews enable row level security;

drop policy if exists tenant_isolation on private_marketplace_listings;
create policy tenant_isolation on private_marketplace_listings
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on marketplace_installation_previews;
create policy tenant_isolation on marketplace_installation_previews
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
`;
