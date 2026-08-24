alter table tenants
  add column if not exists strategic_mute_days integer not null default 30;

alter table tenants
  drop constraint if exists tenants_strategic_mute_days_range;

alter table tenants
  add constraint tenants_strategic_mute_days_range
  check (strategic_mute_days between 1 and 365);
