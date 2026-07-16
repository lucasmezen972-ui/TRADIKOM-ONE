create table if not exists export_jobs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  entity_type text not null,
  format text not null,
  status text not null,
  selected_fields text not null,
  date_from text not null,
  date_to text not null,
  row_count integer not null default 0,
  safe_content text,
  content_encoding text,
  content_type text,
  file_name text,
  safe_error_code text,
  expires_at text not null,
  downloaded_at text,
  cancelled_at text,
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  completed_at text,
  unique (tenant_id, id),
  check (entity_type in (
    'contacts', 'companies', 'opportunities', 'tasks', 'activities',
    'products', 'workflows', 'connector_health'
  )),
  check (format in ('csv', 'xlsx', 'json')),
  check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled', 'expired')),
  check (row_count >= 0),
  check (content_encoding is null or content_encoding = 'base64')
);

create index if not exists idx_export_jobs_tenant_status
  on export_jobs (tenant_id, status, created_at desc);
create index if not exists idx_export_jobs_tenant_expiry
  on export_jobs (tenant_id, expires_at);
