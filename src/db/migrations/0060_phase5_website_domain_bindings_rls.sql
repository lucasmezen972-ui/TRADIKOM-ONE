alter table website_domain_bindings enable row level security;
alter table domain_verification_jobs enable row level security;

drop policy if exists tenant_isolation on website_domain_bindings;
create policy tenant_isolation on website_domain_bindings
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on domain_verification_jobs;
create policy tenant_isolation on domain_verification_jobs
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
