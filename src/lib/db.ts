import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

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

let dbPromise: Promise<PGlite> | null = null;

export async function getDb(): Promise<PGlite> {
  if (!dbPromise) {
    dbPromise = createPersistentDb();
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

  const db = await dbPromise;
  await db.close();
  dbPromise = null;
}

export const closeDbForTests = closeDb;

async function createPersistentDb() {
  const dataDir =
    process.env.PGLITE_DATA_DIR ??
    path.join(process.cwd(), ".data", "tradikom-one-pglite");

  await mkdir(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await migrate(db);
  return db;
}

export async function migrate(db: DbClient) {
  await db.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at text not null
    );
  `);

  const applied = await db.query<{ id: string }>(
    "select id from schema_migrations where id = $1",
    ["001_initial"],
  );

  if (applied.rows.length > 0) {
    return;
  }

  for (const statement of initialMigrationSql
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)) {
    await db.query(statement);
  }
  await db.query(
    "insert into schema_migrations (id, applied_at) values ($1, $2)",
    ["001_initial", new Date().toISOString()],
  );
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
  expires_at text not null,
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
