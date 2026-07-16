alter table connector_installations enable row level security;
alter table connector_executions enable row level security;
alter table connector_health_records enable row level security;

drop policy if exists tenant_isolation on connector_installations;
create policy tenant_isolation on connector_installations
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on connector_executions;
create policy tenant_isolation on connector_executions
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on connector_health_records;
create policy tenant_isolation on connector_health_records
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
