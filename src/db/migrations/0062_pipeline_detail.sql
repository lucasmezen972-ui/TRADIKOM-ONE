alter table opportunities add column if not exists assigned_user_id text
  references users(id);
alter table opportunities add column if not exists probability integer;
alter table opportunities add column if not exists expected_close_at text;

create table if not exists opportunity_changes (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  opportunity_id text not null,
  field text not null,
  previous_value text,
  next_value text,
  changed_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, opportunity_id)
    references opportunities(tenant_id, id) on delete cascade
);

create index if not exists idx_opportunity_changes_tenant_opportunity
  on opportunity_changes (tenant_id, opportunity_id, created_at desc);
create index if not exists idx_opportunities_tenant_assigned
  on opportunities (tenant_id, assigned_user_id);
