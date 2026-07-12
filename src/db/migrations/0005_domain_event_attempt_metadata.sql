-- Persist observable retry/backoff metadata for durable domain events.

alter table domain_events add column if not exists last_attempted_at text;
alter table domain_events add column if not exists last_retry_delay_ms integer not null default 0;
alter table domain_events add column if not exists failure_classification text;
alter table domain_events add column if not exists max_attempts integer;

create index if not exists idx_domain_events_failure
  on domain_events(tenant_id, status, failure_classification, updated_at desc);
