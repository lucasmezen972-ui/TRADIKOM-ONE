alter table website_ai_proposals enable row level security;
alter table website_ai_evidence enable row level security;
alter table website_ai_decisions enable row level security;

drop policy if exists tenant_isolation on website_ai_proposals;
create policy tenant_isolation on website_ai_proposals
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on website_ai_evidence;
create policy tenant_isolation on website_ai_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on website_ai_decisions;
create policy tenant_isolation on website_ai_decisions
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
