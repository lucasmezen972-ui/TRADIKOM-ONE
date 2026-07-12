alter table rate_limits add column if not exists operation_key text not null default 'legacy';
alter table rate_limits add column if not exists subject_hash text not null default '';
alter table rate_limits add column if not exists scope_hash text not null default '';

create index if not exists idx_rate_limits_operation_scope
  on rate_limits(operation_key, scope_hash, reset_at);
create index if not exists idx_rate_limits_cleanup
  on rate_limits(reset_at);
