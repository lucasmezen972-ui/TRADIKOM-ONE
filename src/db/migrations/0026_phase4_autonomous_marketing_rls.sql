alter table marketing_campaign_proposals enable row level security;
alter table marketing_campaign_evidence enable row level security;
alter table marketing_campaign_decisions enable row level security;

drop policy if exists tenant_isolation on marketing_campaign_proposals;
create policy tenant_isolation on marketing_campaign_proposals
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on marketing_campaign_evidence;
create policy tenant_isolation on marketing_campaign_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on marketing_campaign_decisions;
create policy tenant_isolation on marketing_campaign_decisions
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
