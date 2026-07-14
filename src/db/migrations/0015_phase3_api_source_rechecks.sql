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
