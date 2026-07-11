import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { closePgPool, getDatabaseUrl, pgPoolAsSqlClient } from "@/db/client";

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

export async function migrate(
  db: DbClient,
  options: { enableRls?: boolean } = {},
) {
  await db.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at text not null
    );
  `);

  for (const migration of getMigrations(options.enableRls ?? false)) {
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
  select coalesce(nullif(current_setting('app.system_access', true), ''), 'false') = 'true'
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
