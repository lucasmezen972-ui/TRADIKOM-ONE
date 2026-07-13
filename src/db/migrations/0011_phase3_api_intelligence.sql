alter table users add column if not exists platform_role text not null default 'user';

create table if not exists software_directory_entries (
  id text primary key,
  canonical_name text not null,
  aliases text not null,
  vendor text not null,
  official_domain text not null unique,
  country text,
  supported_regions text not null,
  languages text not null,
  industries text not null,
  categories text not null,
  official_website text not null,
  developer_portal text,
  support_page text,
  partner_program_page text,
  pricing_information_page text,
  verification_status text not null,
  confidence_score integer not null,
  last_verified_at text,
  evidence_count integer not null default 0,
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null
);

create table if not exists software_domains (
  id text primary key,
  software_id text not null references software_directory_entries(id) on delete cascade,
  domain text not null unique,
  approval_status text not null,
  decision_reason text,
  approved_by text references users(id),
  approved_at text,
  created_at text not null,
  updated_at text not null
);

create table if not exists api_products (
  id text primary key,
  software_id text not null references software_directory_entries(id) on delete cascade,
  name text not null,
  api_style text not null,
  version text not null,
  base_url text,
  documentation_url text not null,
  openapi_url text,
  postman_collection_url text,
  graphql_schema_url text,
  authentication_type text not null,
  oauth_metadata text not null,
  scopes text not null,
  webhook_support integer not null default 0,
  sandbox_support integer not null default 0,
  partner_access_requirement integer not null default 0,
  access_level text not null,
  rate_limit_information text,
  deprecation_status text not null,
  terms_url text,
  confidence_score integer not null,
  last_verified_at text,
  created_at text not null,
  updated_at text not null,
  unique (software_id, name, version)
);

create table if not exists api_sources (
  id text primary key,
  software_id text not null references software_directory_entries(id) on delete cascade,
  api_product_id text references api_products(id) on delete set null,
  canonical_url text not null unique,
  source_type text not null,
  source_classification text not null,
  publisher_domain text not null,
  created_by text not null references users(id),
  created_at text not null
);

create table if not exists api_source_snapshots (
  id text primary key,
  source_id text not null references api_sources(id) on delete cascade,
  retrieved_at text not null,
  http_status integer not null,
  etag text,
  last_modified text,
  content_hash text not null,
  parser_version text not null,
  robots_decision text not null,
  access_policy_decision text not null,
  content_type text not null,
  content text not null,
  safe_metadata text not null,
  created_at text not null,
  unique (source_id, content_hash)
);

create table if not exists api_schemas (
  id text primary key,
  api_product_id text not null references api_products(id) on delete cascade,
  source_snapshot_id text not null references api_source_snapshots(id) on delete cascade,
  schema_name text not null,
  schema_document text not null,
  created_at text not null,
  unique (api_product_id, source_snapshot_id, schema_name)
);

create table if not exists api_operations (
  id text primary key,
  api_product_id text not null references api_products(id) on delete cascade,
  source_snapshot_id text not null references api_source_snapshots(id) on delete cascade,
  operation_key text not null,
  method text not null,
  path text not null,
  summary text not null,
  tags text not null,
  capability text not null,
  deprecated integer not null default 0,
  request_schema_ref text,
  response_schema_ref text,
  security_requirements text not null,
  created_at text not null,
  unique (api_product_id, operation_key)
);

create table if not exists api_claims (
  id text primary key,
  source_snapshot_id text not null references api_source_snapshots(id) on delete cascade,
  subject_type text not null,
  subject_id text not null,
  claim_type text not null,
  claim_value text not null,
  confidence text not null,
  approval_status text not null,
  created_at text not null
);

create table if not exists api_evidence (
  id text primary key,
  claim_id text not null references api_claims(id) on delete cascade,
  source_snapshot_id text not null references api_source_snapshots(id) on delete cascade,
  locator text not null,
  excerpt_hash text not null,
  created_at text not null
);

create table if not exists api_verification_decisions (
  id text primary key,
  claim_id text not null references api_claims(id) on delete cascade,
  decision text not null,
  reason text not null,
  decided_by text not null references users(id),
  created_at text not null
);

create table if not exists api_contradictions (
  id text primary key,
  claim_id text not null references api_claims(id) on delete cascade,
  contradicting_claim_id text not null references api_claims(id) on delete cascade,
  status text not null,
  created_at text not null
);

create table if not exists api_global_mappings (
  id text primary key,
  api_product_id text not null references api_products(id) on delete cascade,
  source_entity text not null,
  canonical_entity text not null,
  source_field text,
  canonical_field text,
  confidence integer not null,
  evidence_id text not null references api_evidence(id),
  approval_status text not null,
  version integer not null,
  created_by text not null references users(id),
  approved_by text references users(id),
  created_at text not null,
  updated_at text not null
);

create table if not exists api_tenant_mappings (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  api_product_id text not null references api_products(id) on delete cascade,
  source_entity text not null,
  canonical_entity text not null,
  source_field text,
  canonical_field text,
  confidence integer not null,
  evidence_id text not null references api_evidence(id),
  approval_status text not null,
  version integer not null,
  created_by text not null references users(id),
  approved_by text references users(id),
  created_at text not null,
  updated_at text not null
);

create table if not exists api_compatibility_checks (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  software_id text not null references software_directory_entries(id) on delete cascade,
  api_product_id text not null references api_products(id) on delete cascade,
  desired_automation text not null,
  outcome text not null,
  result text not null,
  created_by text not null references users(id),
  created_at text not null
);

create table if not exists connector_proposals (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  software_id text not null references software_directory_entries(id) on delete cascade,
  api_product_id text not null references api_products(id) on delete cascade,
  name text not null,
  version text not null,
  status text not null,
  enabled integer not null default 0,
  manifest text not null,
  unresolved_questions text not null,
  risk_assessment text not null,
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null
);

create table if not exists connector_contract_runs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  connector_proposal_id text not null references connector_proposals(id) on delete cascade,
  connector_version text not null,
  api_version text not null,
  test_suite_version text not null,
  environment text not null,
  status text not null,
  results text not null,
  safe_logs text not null,
  created_at text not null
);

create table if not exists connector_approval_requests (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  connector_proposal_id text not null references connector_proposals(id) on delete cascade,
  requested_scope text not null,
  status text not null,
  submitted_by text not null references users(id),
  decided_by text references users(id),
  decision_reason text,
  created_at text not null,
  decided_at text
);

create table if not exists private_connect_store_entries (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  connector_proposal_id text not null references connector_proposals(id) on delete cascade,
  verification_status text not null,
  installation_status text not null,
  last_tested_at text not null,
  known_limitations text not null,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, connector_proposal_id)
);

create index if not exists idx_software_domains_status on software_domains(approval_status, domain);
create index if not exists idx_api_sources_software on api_sources(software_id, publisher_domain);
create index if not exists idx_api_snapshots_source on api_source_snapshots(source_id, retrieved_at desc);
create index if not exists idx_api_operations_product on api_operations(api_product_id, capability, path);
create index if not exists idx_api_schemas_product on api_schemas(api_product_id, schema_name);
create index if not exists idx_api_claims_subject on api_claims(subject_type, subject_id, claim_type);
create index if not exists idx_api_tenant_mappings_tenant on api_tenant_mappings(tenant_id, api_product_id);
create index if not exists idx_api_compatibility_tenant on api_compatibility_checks(tenant_id, created_at desc);
create index if not exists idx_connector_proposals_tenant on connector_proposals(tenant_id, status, updated_at desc);
create index if not exists idx_connector_contract_runs_tenant on connector_contract_runs(tenant_id, connector_proposal_id, created_at desc);
create index if not exists idx_connector_approval_requests_tenant on connector_approval_requests(tenant_id, status, created_at desc);
create index if not exists idx_private_connect_store_tenant on private_connect_store_entries(tenant_id, updated_at desc);
