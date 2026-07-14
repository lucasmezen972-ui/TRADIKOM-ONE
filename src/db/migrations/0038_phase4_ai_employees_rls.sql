alter table ai_employee_profiles enable row level security;
alter table ai_employee_activity_logs enable row level security;

drop policy if exists tenant_isolation on ai_employee_profiles;
create policy tenant_isolation on ai_employee_profiles
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on ai_employee_activity_logs;
create policy tenant_isolation on ai_employee_activity_logs
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
