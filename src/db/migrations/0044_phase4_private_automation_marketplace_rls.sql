alter table automation_marketplace_packages enable row level security;
alter table automation_marketplace_previews enable row level security;

drop policy if exists tenant_isolation on automation_marketplace_packages;
create policy tenant_isolation on automation_marketplace_packages
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on automation_marketplace_previews;
create policy tenant_isolation on automation_marketplace_previews
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
