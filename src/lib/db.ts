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
