create table if not exists connector_installations (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  software_connection_id text not null,
  connector_key text not null,
  connector_version text not null,
  api_version text not null,
  environment text not null,
  status text not null,
  approved_operations text not null,
  required_scopes text not null,
  rate_limit_limit integer not null default 20,
  rate_limit_remaining integer not null default 20,
  rate_limit_reset_at text not null,
  security_suspended integer not null default 0,
  breaking_change_blocked integer not null default 0,
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, software_connection_id, connector_key),
  foreign key (tenant_id, software_connection_id)
    references software_connections(tenant_id, id) on delete cascade,
  check (environment in ('mock', 'sandbox', 'production')),
  check (status in (
    'proposed', 'sandbox_approved', 'installed_disabled',
    'read_only_enabled', 'write_approval_required', 'write_enabled',
    'suspended', 'authentication_expired', 'unhealthy', 'disconnected',
    'revoked'
  )),
  check (rate_limit_limit > 0),
  check (rate_limit_remaining >= 0),
  check (security_suspended in (0, 1)),
  check (breaking_change_blocked in (0, 1))
);

create table if not exists connector_executions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  connector_installation_id text not null,
  connector_version text not null,
  environment text not null,
  operation text not null,
  capability text not null,
  idempotency_key text not null,
  correlation_id text not null,
  started_at text not null,
  completed_at text,
  status text not null,
  safe_result_summary text,
  safe_error_classification text,
  retry_count integer not null default 0,
  rate_limit_remaining integer,
  rate_limit_reset_at text,
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, connector_installation_id, idempotency_key),
  foreign key (tenant_id, connector_installation_id)
    references connector_installations(tenant_id, id) on delete cascade,
  check (environment in ('mock', 'sandbox', 'production')),
  check (capability in ('read', 'write')),
  check (status in ('running', 'succeeded', 'failed', 'denied', 'cancelled')),
  check (retry_count >= 0),
  check (rate_limit_remaining is null or rate_limit_remaining >= 0)
);

create table if not exists connector_health_records (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  connector_installation_id text not null,
  health_state text not null,
  authentication_state text not null,
  last_successful_sync_at text,
  last_failed_sync_at text,
  latency_ms integer,
  rate_limit_remaining integer,
  rate_limit_reset_at text,
  api_version text not null,
  connector_version text not null,
  webhook_state text not null,
  schema_drift_state text not null,
  breaking_change_state text not null,
  retry_backlog integer not null default 0,
  recommended_action text not null,
  observed_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, connector_installation_id),
  foreign key (tenant_id, connector_installation_id)
    references connector_installations(tenant_id, id) on delete cascade,
  check (health_state in (
    'healthy', 'degraded', 'action_required', 'authentication_required',
    'rate_limited', 'schema_changed', 'suspended', 'disconnected', 'unknown'
  )),
  check (authentication_state in ('valid', 'expired', 'revoked', 'unknown')),
  check (latency_ms is null or latency_ms >= 0),
  check (rate_limit_remaining is null or rate_limit_remaining >= 0),
  check (retry_backlog >= 0)
);

create index if not exists idx_connector_installations_tenant_status
  on connector_installations (tenant_id, status, updated_at desc);
create index if not exists idx_connector_executions_tenant_installation
  on connector_executions (tenant_id, connector_installation_id, created_at desc);
create index if not exists idx_connector_health_tenant_state
  on connector_health_records (tenant_id, health_state, observed_at desc);
