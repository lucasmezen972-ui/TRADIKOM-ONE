alter table strategic_recommendations enable row level security;
alter table strategic_recommendation_evidence enable row level security;
alter table strategic_recommendation_decisions enable row level security;

drop policy if exists tenant_isolation on strategic_recommendations;
create policy tenant_isolation on strategic_recommendations
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on strategic_recommendation_evidence;
create policy tenant_isolation on strategic_recommendation_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on strategic_recommendation_decisions;
create policy tenant_isolation on strategic_recommendation_decisions
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
