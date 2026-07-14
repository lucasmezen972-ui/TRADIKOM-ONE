create unique index if not exists uq_workflows_tenant_id
  on workflows(tenant_id, id);

create table if not exists private_marketplace_listings (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  listing_key text not null check (char_length(listing_key) between 3 and 200),
  category text not null check (category in ('connector', 'workflow', 'ai_employee')),
  source_kind text not null check (source_kind in ('connector_plan', 'workflow', 'ai_employee_profile')),
  connector_plan_id text,
  workflow_id text,
  ai_employee_profile_id text,
  title text not null check (char_length(title) between 3 and 160),
  summary text not null check (char_length(summary) between 10 and 800),
  fingerprint text not null check (char_length(fingerprint) = 64),
  record_status text not null check (record_status in ('current', 'superseded')),
  visibility text not null default 'private' check (visibility = 'private'),
  capabilities_snapshot text not null check (char_length(capabilities_snapshot) between 2 and 12000),
  permissions_snapshot text not null check (char_length(permissions_snapshot) between 2 and 12000),
  provenance_snapshot text not null check (char_length(provenance_snapshot) between 2 and 8000),
  version integer not null check (version >= 1),
  supersedes_id text,
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, listing_key, version),
  check (
    (source_kind = 'connector_plan' and connector_plan_id is not null and workflow_id is null and ai_employee_profile_id is null)
    or (source_kind = 'workflow' and connector_plan_id is null and workflow_id is not null and ai_employee_profile_id is null)
    or (source_kind = 'ai_employee_profile' and connector_plan_id is null and workflow_id is null and ai_employee_profile_id is not null)
  ),
  foreign key (tenant_id, connector_plan_id)
    references connector_installation_plans(tenant_id, id) on delete restrict,
  foreign key (tenant_id, workflow_id)
    references workflows(tenant_id, id) on delete restrict,
  foreign key (tenant_id, ai_employee_profile_id)
    references ai_employee_profiles(tenant_id, id) on delete restrict,
  foreign key (tenant_id, supersedes_id)
    references private_marketplace_listings(tenant_id, id) on delete restrict
);

create unique index if not exists idx_private_marketplace_listings_current
  on private_marketplace_listings(tenant_id, listing_key)
  where record_status = 'current';

create index if not exists idx_private_marketplace_listings_tenant_category
  on private_marketplace_listings(tenant_id, category, record_status, updated_at desc);

create table if not exists marketplace_installation_previews (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  listing_id text not null,
  listing_version integer not null check (listing_version >= 1),
  listing_fingerprint text not null check (char_length(listing_fingerprint) = 64),
  status text not null default 'ready' check (status = 'ready'),
  installation_mode text not null default 'preview_only' check (installation_mode = 'preview_only'),
  enabled integer not null default 0 check (enabled = 0),
  installation_steps text not null check (char_length(installation_steps) between 2 and 8000),
  permission_review text not null check (char_length(permission_review) between 2 and 8000),
  blockers text not null check (char_length(blockers) between 2 and 4000),
  created_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, listing_id, listing_version),
  foreign key (tenant_id, listing_id)
    references private_marketplace_listings(tenant_id, id) on delete restrict
);

create index if not exists idx_marketplace_previews_tenant_listing
  on marketplace_installation_previews(tenant_id, listing_id, created_at desc);
