-- Phase 2 PostgreSQL foundation migration.
-- The application still supports PGlite for local fallback, but DATABASE_URL is
-- the production runtime path.

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
