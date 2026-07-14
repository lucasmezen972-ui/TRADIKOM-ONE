create table if not exists connector_repair_proposals (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  api_change_impact_id text not null unique
    references api_change_impacts(id) on delete cascade,
  source_connector_proposal_id text not null
    references connector_proposals(id) on delete cascade,
  replacement_connector_proposal_id text not null unique
    references connector_proposals(id) on delete cascade,
  source_snapshot_id text not null
    references api_source_snapshots(id) on delete cascade,
  generation_summary text not null,
  created_by text not null references users(id),
  created_at text not null,
  check (source_connector_proposal_id <> replacement_connector_proposal_id)
);

create index if not exists idx_connector_repairs_tenant
  on connector_repair_proposals(tenant_id, created_at desc);
