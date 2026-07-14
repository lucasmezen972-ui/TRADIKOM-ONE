alter table software_connections enable row level security;
alter table oauth_states enable row level security;
alter table oauth_credentials enable row level security;

drop policy if exists tenant_isolation on software_connections;
create policy tenant_isolation on software_connections
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on oauth_states;
create policy tenant_isolation on oauth_states
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on oauth_credentials;
create policy tenant_isolation on oauth_credentials
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
