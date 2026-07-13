alter table api_change_impacts enable row level security;

drop policy if exists tenant_isolation on api_change_impacts;
create policy tenant_isolation on api_change_impacts
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop trigger if exists api_change_impacts_tenant_integrity on api_change_impacts;
create trigger api_change_impacts_tenant_integrity
  before insert or update of tenant_id, connector_proposal_id on api_change_impacts
  for each row execute function app_enforce_related_tenant('connector_proposals', 'connector_proposal_id');


create or replace function app_enforce_api_change_event_integrity()
returns trigger language plpgsql as $$
declare
  source_product_id text;
  previous_source_id text;
  current_source_id text;
begin
  select api_product_id into source_product_id
    from api_sources where id = new.source_id;
  select source_id into previous_source_id
    from api_source_snapshots where id = new.previous_snapshot_id;
  select source_id into current_source_id
    from api_source_snapshots where id = new.current_snapshot_id;

  if source_product_id is null
     or source_product_id <> new.api_product_id
     or previous_source_id <> new.source_id
     or current_source_id <> new.source_id then
    raise exception 'Invalid API change event relation';
  end if;
  return new;
end;
$$;

drop trigger if exists api_change_events_relation_integrity on api_change_events;
create trigger api_change_events_relation_integrity
  before insert or update of api_product_id, source_id, previous_snapshot_id, current_snapshot_id
  on api_change_events
  for each row execute function app_enforce_api_change_event_integrity();

create or replace function app_enforce_api_change_impact_product()
returns trigger language plpgsql as $$
declare
  event_product_id text;
  proposal_product_id text;
begin
  select api_product_id into event_product_id
    from api_change_events where id = new.api_change_event_id;
  select api_product_id into proposal_product_id
    from connector_proposals where id = new.connector_proposal_id;

  if event_product_id is null
     or proposal_product_id is null
     or event_product_id <> proposal_product_id then
    raise exception 'Invalid API change impact relation';
  end if;
  return new;
end;
$$;

drop trigger if exists api_change_impacts_product_integrity on api_change_impacts;
create trigger api_change_impacts_product_integrity
  before insert or update of api_change_event_id, connector_proposal_id
  on api_change_impacts
  for each row execute function app_enforce_api_change_impact_product();
