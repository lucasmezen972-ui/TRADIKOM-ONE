create table if not exists ai_employee_profiles (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  employee_key text not null check (char_length(employee_key) between 3 and 80),
  role_key text not null check (role_key in (
    'marketing_manager', 'sales_assistant', 'receptionist', 'customer_support',
    'seo_specialist', 'content_writer', 'business_analyst',
    'automation_engineer', 'website_manager'
  )),
  display_name text not null check (char_length(display_name) between 3 and 100),
  purpose text not null check (char_length(purpose) between 10 and 500),
  operational_status text not null check (operational_status in ('enabled', 'paused')),
  record_status text not null check (record_status in ('current', 'superseded')),
  skills text not null check (char_length(skills) between 2 and 8000),
  memory_domains text not null check (char_length(memory_domains) between 2 and 2000),
  permissions text not null check (char_length(permissions) between 2 and 8000),
  working_hours text not null check (char_length(working_hours) between 2 and 2000),
  tools text not null check (char_length(tools) between 2 and 8000),
  approval_limits text not null check (char_length(approval_limits) between 2 and 4000),
  kpis text not null check (char_length(kpis) between 2 and 8000),
  version integer not null check (version >= 1),
  supersedes_id text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, employee_key, version),
  foreign key (tenant_id, supersedes_id)
    references ai_employee_profiles(tenant_id, id) on delete restrict
);

create unique index if not exists idx_ai_employee_profiles_current
  on ai_employee_profiles(tenant_id, employee_key)
  where record_status = 'current';

create table if not exists ai_employee_activity_logs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  employee_key text not null check (char_length(employee_key) between 3 and 80),
  profile_id text not null,
  activity_type text not null check (activity_type in (
    'provisioned', 'initialized', 'profile_revised', 'paused', 'resumed'
  )),
  summary text not null check (char_length(summary) between 10 and 500),
  safe_metadata text not null check (char_length(safe_metadata) between 2 and 4000),
  actor_id text references users(id),
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, profile_id)
    references ai_employee_profiles(tenant_id, id) on delete restrict
);

create index if not exists idx_ai_employee_profiles_tenant_status
  on ai_employee_profiles(tenant_id, record_status, operational_status, role_key);

create index if not exists idx_ai_employee_activity_tenant_employee
  on ai_employee_activity_logs(tenant_id, employee_key, created_at desc);

create index if not exists idx_ai_employee_activity_tenant_profile
  on ai_employee_activity_logs(tenant_id, profile_id, created_at desc);
