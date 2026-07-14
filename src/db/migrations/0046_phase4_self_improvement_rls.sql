alter table self_improvement_proposals enable row level security;
alter table self_improvement_evidence enable row level security;
alter table self_improvement_decisions enable row level security;

drop policy if exists tenant_isolation on self_improvement_proposals;
create policy tenant_isolation on self_improvement_proposals
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on self_improvement_evidence;
create policy tenant_isolation on self_improvement_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on self_improvement_decisions;
create policy tenant_isolation on self_improvement_decisions
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
