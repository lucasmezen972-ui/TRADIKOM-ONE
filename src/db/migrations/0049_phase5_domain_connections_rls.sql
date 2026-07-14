alter table domain_connections enable row level security;
alter table dns_snapshots enable row level security;
alter table dns_change_plans enable row level security;
alter table dns_change_approvals enable row level security;

drop policy if exists tenant_isolation on domain_connections;
create policy tenant_isolation on domain_connections
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on dns_snapshots;
create policy tenant_isolation on dns_snapshots
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on dns_change_plans;
create policy tenant_isolation on dns_change_plans
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on dns_change_approvals;
create policy tenant_isolation on dns_change_approvals
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
