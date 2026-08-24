alter table tenant_assets enable row level security;

drop policy if exists tenant_isolation on tenant_assets;
create policy tenant_isolation on tenant_assets
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
