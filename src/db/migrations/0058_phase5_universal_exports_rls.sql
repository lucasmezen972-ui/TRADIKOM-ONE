alter table export_jobs enable row level security;

drop policy if exists tenant_isolation on export_jobs;
create policy tenant_isolation on export_jobs
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
