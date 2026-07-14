alter table connector_installation_plans enable row level security;

drop policy if exists tenant_isolation on connector_installation_plans;
create policy tenant_isolation on connector_installation_plans
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
