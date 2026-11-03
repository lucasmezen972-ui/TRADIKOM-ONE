alter table channel_provider_endpoints enable row level security;

drop policy if exists tenant_isolation on channel_provider_endpoints;
create policy tenant_isolation on channel_provider_endpoints
  for all
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
