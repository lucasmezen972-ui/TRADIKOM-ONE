alter table connector_repair_proposals enable row level security;

drop policy if exists tenant_isolation on connector_repair_proposals;
create policy tenant_isolation on connector_repair_proposals
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop trigger if exists connector_repairs_impact_tenant_integrity
  on connector_repair_proposals;
create trigger connector_repairs_impact_tenant_integrity
  before insert or update of tenant_id, api_change_impact_id
  on connector_repair_proposals
  for each row execute function app_enforce_related_tenant(
    'api_change_impacts', 'api_change_impact_id'
  );

drop trigger if exists connector_repairs_source_tenant_integrity
  on connector_repair_proposals;
create trigger connector_repairs_source_tenant_integrity
  before insert or update of tenant_id, source_connector_proposal_id
  on connector_repair_proposals
  for each row execute function app_enforce_related_tenant(
    'connector_proposals', 'source_connector_proposal_id'
  );

drop trigger if exists connector_repairs_replacement_tenant_integrity
  on connector_repair_proposals;
create trigger connector_repairs_replacement_tenant_integrity
  before insert or update of tenant_id, replacement_connector_proposal_id
  on connector_repair_proposals
  for each row execute function app_enforce_related_tenant(
    'connector_proposals', 'replacement_connector_proposal_id'
  );

create or replace function app_enforce_connector_repair_integrity()
returns trigger language plpgsql as $$
declare
  expected_snapshot_id text;
  impact_product_id text;
  source_product_id text;
  replacement_product_id text;
begin
  select api_change_events.current_snapshot_id,
         api_change_events.api_product_id
    into expected_snapshot_id, impact_product_id
    from api_change_impacts
    join api_change_events
      on api_change_events.id = api_change_impacts.api_change_event_id
   where api_change_impacts.id = new.api_change_impact_id;
  select api_product_id into source_product_id
    from connector_proposals where id = new.source_connector_proposal_id;
  select api_product_id into replacement_product_id
    from connector_proposals where id = new.replacement_connector_proposal_id;

  if expected_snapshot_id is null
     or expected_snapshot_id <> new.source_snapshot_id
     or impact_product_id <> source_product_id
     or impact_product_id <> replacement_product_id then
    raise exception 'Invalid connector repair relation';
  end if;
  return new;
end;
$$;

drop trigger if exists connector_repairs_relation_integrity
  on connector_repair_proposals;
create trigger connector_repairs_relation_integrity
  before insert or update of api_change_impact_id,
    source_connector_proposal_id, replacement_connector_proposal_id,
    source_snapshot_id
  on connector_repair_proposals
  for each row execute function app_enforce_connector_repair_integrity();
