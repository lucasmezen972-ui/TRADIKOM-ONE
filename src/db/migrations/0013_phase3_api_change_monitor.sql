alter table api_source_snapshots
  drop constraint if exists api_source_snapshots_source_id_content_hash_key;

create table if not exists api_change_events (
  id text primary key,
  api_product_id text not null references api_products(id) on delete cascade,
  source_id text not null references api_sources(id) on delete cascade,
  previous_snapshot_id text not null references api_source_snapshots(id) on delete cascade,
  current_snapshot_id text not null references api_source_snapshots(id) on delete cascade,
  primary_classification text not null,
  classifications text not null,
  summary text not null,
  requires_approval integer not null default 0,
  detected_at text not null,
  created_at text not null,
  unique (previous_snapshot_id, current_snapshot_id)
);

create table if not exists api_change_impacts (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  api_change_event_id text not null references api_change_events(id) on delete cascade,
  connector_proposal_id text not null references connector_proposals(id) on delete cascade,
  contract_run_id text references connector_contract_runs(id) on delete set null,
  status text not null,
  upgrade_blocked integer not null default 1,
  repair_proposal text not null,
  contract_test_status text not null,
  contract_test_results text not null,
  approval_status text not null,
  decided_by text references users(id),
  decision_reason text,
  decided_at text,
  created_at text not null,
  updated_at text not null,
  unique (api_change_event_id, connector_proposal_id)
);

create index if not exists idx_api_change_events_product
  on api_change_events(api_product_id, detected_at desc);
create index if not exists idx_api_change_impacts_tenant
  on api_change_impacts(tenant_id, status, created_at desc);
create index if not exists idx_api_change_impacts_proposal
  on api_change_impacts(connector_proposal_id, created_at desc);
