create unique index if not exists idx_websites_tenant_id_unique
  on websites (tenant_id, id);
create unique index if not exists idx_website_versions_tenant_id_unique
  on website_versions (tenant_id, id);

create table if not exists website_domain_bindings (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  website_id text not null,
  domain_connection_id text not null,
  dns_change_plan_id text not null,
  published_version_id_at_request text not null,
  status text not null,
  certificate_status text not null,
  safe_error_code text,
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  verified_at text,
  disconnected_at text,
  unique (tenant_id, id),
  unique (tenant_id, domain_connection_id),
  foreign key (tenant_id, website_id)
    references websites(tenant_id, id) on delete cascade,
  foreign key (tenant_id, domain_connection_id)
    references domain_connections(tenant_id, id) on delete cascade,
  foreign key (tenant_id, dns_change_plan_id)
    references dns_change_plans(tenant_id, id) on delete restrict,
  foreign key (tenant_id, published_version_id_at_request)
    references website_versions(tenant_id, id) on delete restrict,
  check (status in (
    'pending_verification', 'verified', 'bound', 'failed', 'disconnected'
  )),
  check (certificate_status in ('pending', 'available', 'unavailable', 'unknown'))
);

create table if not exists domain_verification_jobs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  website_domain_binding_id text not null,
  status text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  next_run_at text not null,
  lease_expires_at text,
  correlation_id text not null,
  safe_error_code text,
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  completed_at text,
  unique (tenant_id, id),
  foreign key (tenant_id, website_domain_binding_id)
    references website_domain_bindings(tenant_id, id) on delete cascade,
  check (status in ('queued', 'processing', 'verified', 'failed', 'cancelled')),
  check (attempts >= 0 and attempts <= max_attempts),
  check (max_attempts between 1 and 10)
);

create index if not exists idx_website_domain_bindings_tenant_status
  on website_domain_bindings (tenant_id, status, updated_at desc);
create index if not exists idx_website_domain_bindings_tenant_website
  on website_domain_bindings (tenant_id, website_id, updated_at desc);
create index if not exists idx_domain_verification_jobs_tenant_schedule
  on domain_verification_jobs (tenant_id, status, next_run_at);
