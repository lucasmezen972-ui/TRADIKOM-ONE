alter table reputation_reviews enable row level security;
alter table reputation_response_proposals enable row level security;
alter table reputation_proposal_evidence enable row level security;
alter table reputation_proposal_decisions enable row level security;

drop policy if exists tenant_isolation on reputation_reviews;
create policy tenant_isolation on reputation_reviews
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on reputation_response_proposals;
create policy tenant_isolation on reputation_response_proposals
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on reputation_proposal_evidence;
create policy tenant_isolation on reputation_proposal_evidence
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on reputation_proposal_decisions;
create policy tenant_isolation on reputation_proposal_decisions
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
