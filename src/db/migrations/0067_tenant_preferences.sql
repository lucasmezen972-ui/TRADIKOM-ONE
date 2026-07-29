alter table tenants
  add column if not exists stalled_opportunity_days integer not null default 7;

alter table tenants
  drop constraint if exists tenants_stalled_opportunity_days_range;

alter table tenants
  add constraint tenants_stalled_opportunity_days_range
  check (stalled_opportunity_days between 1 and 90);
