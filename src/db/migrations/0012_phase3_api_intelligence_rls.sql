alter table api_tenant_mappings enable row level security;
alter table api_compatibility_checks enable row level security;
alter table connector_proposals enable row level security;
alter table connector_contract_runs enable row level security;
alter table connector_approval_requests enable row level security;
alter table private_connect_store_entries enable row level security;

drop policy if exists tenant_isolation on api_tenant_mappings;
create policy tenant_isolation on api_tenant_mappings
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
drop policy if exists tenant_isolation on api_compatibility_checks;
create policy tenant_isolation on api_compatibility_checks
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
drop policy if exists tenant_isolation on connector_proposals;
create policy tenant_isolation on connector_proposals
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
drop policy if exists tenant_isolation on connector_contract_runs;
create policy tenant_isolation on connector_contract_runs
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
drop policy if exists tenant_isolation on connector_approval_requests;
create policy tenant_isolation on connector_approval_requests
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
drop policy if exists tenant_isolation on private_connect_store_entries;
create policy tenant_isolation on private_connect_store_entries
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop trigger if exists connector_contract_runs_tenant_integrity on connector_contract_runs;
create trigger connector_contract_runs_tenant_integrity
  before insert or update of tenant_id, connector_proposal_id on connector_contract_runs
  for each row execute function app_enforce_related_tenant('connector_proposals', 'connector_proposal_id');
drop trigger if exists connector_approval_requests_tenant_integrity on connector_approval_requests;
create trigger connector_approval_requests_tenant_integrity
  before insert or update of tenant_id, connector_proposal_id on connector_approval_requests
  for each row execute function app_enforce_related_tenant('connector_proposals', 'connector_proposal_id');
drop trigger if exists private_connect_store_tenant_integrity on private_connect_store_entries;
create trigger private_connect_store_tenant_integrity
  before insert or update of tenant_id, connector_proposal_id on private_connect_store_entries
  for each row execute function app_enforce_related_tenant('connector_proposals', 'connector_proposal_id');
