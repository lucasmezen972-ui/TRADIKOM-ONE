create table if not exists email_suppressions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  email text not null,
  reason text not null check (reason in ('permanent_failure', 'manual')),
  provider text not null,
  error_code text,
  detail text not null,
  suppressed_by text references users(id),
  created_at text not null,
  unique (tenant_id, email),
  unique (tenant_id, id)
);

create index if not exists idx_email_suppressions_tenant_created
  on email_suppressions (tenant_id, created_at desc);
