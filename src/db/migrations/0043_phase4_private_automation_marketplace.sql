create table if not exists automation_marketplace_packages (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  listing_id text not null,
  source_workflow_id text not null,
  package_key text not null check (char_length(package_key) between 3 and 200),
  title text not null check (char_length(title) between 3 and 160),
  summary text not null check (char_length(summary) between 10 and 800),
  template_snapshot text not null check (char_length(template_snapshot) between 2 and 12000),
  required_configuration text not null check (char_length(required_configuration) between 2 and 8000),
  approval_policy text not null check (char_length(approval_policy) between 3 and 100),
  fingerprint text not null check (char_length(fingerprint) = 64),
  record_status text not null check (record_status in ('current', 'superseded')),
  visibility text not null default 'tenant_private' check (visibility = 'tenant_private'),
  execution_enabled integer not null default 0 check (execution_enabled = 0),
  version integer not null check (version >= 1),
  supersedes_id text,
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, package_key, version),
  foreign key (tenant_id, listing_id)
    references private_marketplace_listings(tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_workflow_id)
    references workflows(tenant_id, id) on delete restrict,
  foreign key (tenant_id, supersedes_id)
    references automation_marketplace_packages(tenant_id, id) on delete restrict
);

create unique index if not exists idx_automation_marketplace_packages_current
  on automation_marketplace_packages(tenant_id, package_key)
  where record_status = 'current';

create index if not exists idx_automation_marketplace_packages_tenant_status
  on automation_marketplace_packages(tenant_id, record_status, updated_at desc);

create table if not exists automation_marketplace_previews (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  package_id text not null,
  package_version integer not null check (package_version >= 1),
  package_fingerprint text not null check (char_length(package_fingerprint) = 64),
  status text not null default 'ready' check (status = 'ready'),
  installation_mode text not null default 'preview_only' check (installation_mode = 'preview_only'),
  execution_enabled integer not null default 0 check (execution_enabled = 0),
  preview_steps text not null check (char_length(preview_steps) between 2 and 8000),
  permission_review text not null check (char_length(permission_review) between 2 and 8000),
  blockers text not null check (char_length(blockers) between 2 and 4000),
  created_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, package_id, package_version),
  foreign key (tenant_id, package_id)
    references automation_marketplace_packages(tenant_id, id) on delete restrict
);

create index if not exists idx_automation_marketplace_previews_tenant_package
  on automation_marketplace_previews(tenant_id, package_id, created_at desc);
