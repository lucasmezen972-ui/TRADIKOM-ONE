alter table oauth_states
  add column if not exists authorization_code_hash text;

alter table oauth_states
  add column if not exists authorized_at text;

create index if not exists idx_oauth_states_tenant_authorized
  on oauth_states (tenant_id, authorized_at, expires_at);
