alter table business_brain_entries enable row level security;
alter table business_brain_evidence enable row level security;

drop policy if exists tenant_isolation on business_brain_entries;
create policy tenant_isolation on business_brain_entries
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on business_brain_evidence;
create policy tenant_isolation on business_brain_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
