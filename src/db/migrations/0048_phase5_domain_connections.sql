create table if not exists domain_connections (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  normalized_domain text not null,
  provider_key text not null,
  provider_label text not null,
  state text not null,
  likely_registrar text,
  likely_hosting text,
  certificate_status text not null,
  evidence text not null,
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, normalized_domain),
  check (provider_key in ('mock_dns', 'manual')),
  check (state in (
    'discovered', 'analysis_pending', 'analyzed', 'manual_setup_required',
    'provider_connection_available', 'change_plan_ready', 'awaiting_approval',
    'applying', 'propagation_pending', 'verified', 'failed',
    'rollback_required', 'disconnected'
  )),
  check (certificate_status in ('available', 'unavailable', 'unknown'))
);

create table if not exists dns_snapshots (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  domain_connection_id text not null,
  records text not null,
  evidence text not null,
  captured_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, domain_connection_id)
    references domain_connections(tenant_id, id) on delete cascade
);

create table if not exists dns_change_plans (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  domain_connection_id text not null,
  dns_snapshot_id text not null,
  provider_key text not null,
  status text not null,
  proposed_changes text not null,
  impact_analysis text not null,
  rollback_snapshot text not null,
  verification_checks text not null,
  expires_at text not null,
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, domain_connection_id)
    references domain_connections(tenant_id, id) on delete cascade,
  foreign key (tenant_id, dns_snapshot_id)
    references dns_snapshots(tenant_id, id) on delete restrict,
  check (provider_key in ('mock_dns', 'manual')),
  check (status in (
    'awaiting_approval', 'awaiting_second_confirmation',
    'approved_for_simulation', 'simulated', 'expired', 'rejected'
  ))
);

create table if not exists dns_change_approvals (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  dns_change_plan_id text not null,
  approval_type text not null,
  decision text not null,
  actor_id text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, dns_change_plan_id, approval_type),
  foreign key (tenant_id, dns_change_plan_id)
    references dns_change_plans(tenant_id, id) on delete cascade,
  check (approval_type in ('primary', 'second_confirmation')),
  check (decision in ('approved', 'rejected'))
);

create index if not exists idx_domain_connections_tenant_updated
  on domain_connections (tenant_id, updated_at desc);
create index if not exists idx_dns_snapshots_tenant_connection
  on dns_snapshots (tenant_id, domain_connection_id, captured_at desc);
create index if not exists idx_dns_change_plans_tenant_status
  on dns_change_plans (tenant_id, status, created_at desc);
create index if not exists idx_dns_change_approvals_tenant_plan
  on dns_change_approvals (tenant_id, dns_change_plan_id, created_at desc);
