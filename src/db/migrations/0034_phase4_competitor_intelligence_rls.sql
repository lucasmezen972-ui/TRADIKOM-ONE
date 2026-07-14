alter table competitor_profiles enable row level security;
alter table competitor_observations enable row level security;
alter table competitor_insights enable row level security;
alter table competitor_insight_evidence enable row level security;
alter table competitor_insight_decisions enable row level security;

drop policy if exists tenant_isolation on competitor_profiles;
create policy tenant_isolation on competitor_profiles
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on competitor_observations;
create policy tenant_isolation on competitor_observations
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on competitor_insights;
create policy tenant_isolation on competitor_insights
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on competitor_insight_evidence;
create policy tenant_isolation on competitor_insight_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on competitor_insight_decisions;
create policy tenant_isolation on competitor_insight_decisions
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
