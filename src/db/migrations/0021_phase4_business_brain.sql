create table if not exists business_brain_entries (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  entry_key text not null,
  domain text not null check (domain in (
    'company', 'customers', 'suppliers', 'catalog', 'pricing', 'margins',
    'objectives', 'kpis', 'team', 'locations', 'automations', 'websites',
    'api', 'connectors'
  )),
  title text not null check (char_length(title) between 3 and 120),
  summary text not null check (char_length(summary) between 5 and 1000),
  details text not null check (char_length(details) <= 5000),
  source_type text not null check (source_type in (
    'manual', 'business_twin', 'crm', 'workflow', 'website', 'connector',
    'api_intelligence', 'import'
  )),
  source_ref text check (source_ref is null or char_length(source_ref) <= 500),
  confidence integer not null check (confidence between 0 and 100),
  status text not null check (status in ('active', 'superseded', 'archived')),
  version integer not null check (version > 0),
  supersedes_id text,
  created_by text not null references users(id),
  reviewed_by text references users(id),
  reviewed_at text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, entry_key, version),
  foreign key (tenant_id, supersedes_id)
    references business_brain_entries(tenant_id, id) on delete restrict,
  check (
    (reviewed_by is null and reviewed_at is null)
    or (reviewed_by is not null and reviewed_at is not null)
  )
);

create table if not exists business_brain_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  entry_id text not null,
  evidence_type text not null check (evidence_type in (
    'observation', 'document', 'system_record', 'import'
  )),
  source_ref text check (source_ref is null or char_length(source_ref) <= 500),
  summary text not null check (char_length(summary) between 5 and 500),
  captured_at text not null,
  created_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, entry_id)
    references business_brain_entries(tenant_id, id) on delete cascade
);

create index if not exists idx_business_brain_entries_tenant_status
  on business_brain_entries(tenant_id, status, domain, updated_at desc);

create index if not exists idx_business_brain_entries_tenant_key
  on business_brain_entries(tenant_id, entry_key, version desc);

create index if not exists idx_business_brain_evidence_tenant_entry
  on business_brain_evidence(tenant_id, entry_id, captured_at desc);
