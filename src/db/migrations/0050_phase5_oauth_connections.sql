create table if not exists software_connections (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  software_directory_id text references software_directory_entries(id) on delete restrict,
  software_key text not null,
  software_name text not null,
  provider_key text not null,
  environment text not null,
  status text not null,
  account_label text not null,
  scopes text not null,
  created_by text not null references users(id),
  connected_at text,
  disconnected_at text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  check (environment in ('mock', 'sandbox', 'production')),
  check (status in (
    'oauth_pending', 'connected', 'authentication_expired', 'unhealthy',
    'disconnected', 'revoked'
  ))
);

create table if not exists oauth_states (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  software_connection_id text not null,
  state_hash text not null unique,
  code_challenge text not null,
  code_verifier_encrypted text not null,
  redirect_uri text not null,
  scopes text not null,
  expires_at text not null,
  consumed_at text,
  created_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, software_connection_id)
    references software_connections(tenant_id, id) on delete cascade
);

create table if not exists oauth_credentials (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  software_connection_id text not null,
  provider_key text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  scopes text not null,
  expires_at text not null,
  revoked_at text,
  key_version text not null,
  token_version integer not null default 1,
  refresh_lease_id text,
  refresh_lease_expires_at text,
  last_refreshed_at text,
  last_used_at text,
  failed_authentication_count integer not null default 0,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, software_connection_id, token_version),
  foreign key (tenant_id, software_connection_id)
    references software_connections(tenant_id, id) on delete cascade,
  check (token_version > 0),
  check (failed_authentication_count >= 0)
);

create unique index if not exists idx_oauth_credentials_one_active
  on oauth_credentials (tenant_id, software_connection_id)
  where revoked_at is null;
create index if not exists idx_software_connections_tenant_status
  on software_connections (tenant_id, status, updated_at desc);
create index if not exists idx_oauth_states_tenant_connection
  on oauth_states (tenant_id, software_connection_id, expires_at desc);
create index if not exists idx_oauth_credentials_tenant_connection
  on oauth_credentials (tenant_id, software_connection_id, updated_at desc);
