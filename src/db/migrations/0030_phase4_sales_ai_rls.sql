alter table sales_ai_assessments enable row level security;
alter table sales_ai_evidence enable row level security;

drop policy if exists tenant_isolation on sales_ai_assessments;
create policy tenant_isolation on sales_ai_assessments
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on sales_ai_evidence;
create policy tenant_isolation on sales_ai_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
