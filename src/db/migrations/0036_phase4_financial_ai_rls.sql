alter table financial_input_snapshots enable row level security;
alter table financial_assessments enable row level security;
alter table financial_assessment_evidence enable row level security;
alter table financial_alerts enable row level security;

drop policy if exists tenant_isolation on financial_input_snapshots;
create policy tenant_isolation on financial_input_snapshots
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on financial_assessments;
create policy tenant_isolation on financial_assessments
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on financial_assessment_evidence;
create policy tenant_isolation on financial_assessment_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on financial_alerts;
create policy tenant_isolation on financial_alerts
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
