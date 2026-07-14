create unique index if not exists uq_private_connect_store_tenant_id
  on private_connect_store_entries(tenant_id, id);

create unique index if not exists uq_connector_proposals_tenant_id
  on connector_proposals(tenant_id, id);

create table if not exists connector_installation_plans (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  store_entry_id text not null,
  connector_proposal_id text not null,
  fingerprint text not null check (char_length(fingerprint) = 64),
  record_status text not null check (record_status in ('current', 'superseded')),
  enabled integer not null default 0 check (enabled = 0),
  installation_mode text not null check (installation_mode = 'sandbox_only'),
  tenant_industry text not null check (char_length(tenant_industry) between 1 and 160),
  industry_match text not null check (industry_match in ('aligned', 'not_documented')),
  capabilities_snapshot text not null check (char_length(capabilities_snapshot) between 2 and 12000),
  evidence_summary text not null check (char_length(evidence_summary) between 2 and 8000),
  blockers text not null check (char_length(blockers) between 2 and 4000),
  version integer not null check (version >= 1),
  supersedes_id text,
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, store_entry_id, version),
  foreign key (tenant_id, store_entry_id)
    references private_connect_store_entries(tenant_id, id) on delete restrict,
  foreign key (tenant_id, connector_proposal_id)
    references connector_proposals(tenant_id, id) on delete restrict,
  foreign key (tenant_id, supersedes_id)
    references connector_installation_plans(tenant_id, id) on delete restrict
);

create unique index if not exists idx_connector_installation_plans_current
  on connector_installation_plans(tenant_id, store_entry_id)
  where record_status = 'current';

create index if not exists idx_connector_installation_plans_tenant_status
  on connector_installation_plans(tenant_id, record_status, updated_at desc);

create index if not exists idx_connector_installation_plans_tenant_proposal
  on connector_installation_plans(tenant_id, connector_proposal_id, version desc);
