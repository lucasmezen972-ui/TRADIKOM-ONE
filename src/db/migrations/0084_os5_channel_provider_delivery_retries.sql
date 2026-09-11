alter table channel_provider_deliveries
  add column if not exists attempts integer not null default 0;
alter table channel_provider_deliveries
  add column if not exists max_attempts integer not null default 3;
alter table channel_provider_deliveries
  add column if not exists next_attempt_at text;
alter table channel_provider_deliveries
  add column if not exists last_attempted_at text;
alter table channel_provider_deliveries
  add column if not exists lease_id text;
alter table channel_provider_deliveries
  add column if not exists lease_expires_at text;

update channel_provider_deliveries
set next_attempt_at = updated_at
where next_attempt_at is null;

alter table channel_provider_deliveries
  alter column next_attempt_at set not null;

alter table channel_provider_deliveries
  drop constraint if exists channel_provider_deliveries_attempts_valid;
alter table channel_provider_deliveries
  add constraint channel_provider_deliveries_attempts_valid check (
    attempts between 0 and max_attempts
    and max_attempts between 1 and 10
  );

alter table channel_provider_deliveries
  drop constraint if exists channel_provider_deliveries_retryable_classification_valid;
alter table channel_provider_deliveries
  add constraint channel_provider_deliveries_retryable_classification_valid check (
    retryable is null
    or retryable = false
    or (
      status = 'failed'
      and failure_classification in ('temporary', 'rate_limit')
    )
  );

alter table channel_provider_deliveries
  drop constraint if exists channel_provider_deliveries_attempt_schedule_valid;
alter table channel_provider_deliveries
  add constraint channel_provider_deliveries_attempt_schedule_valid check (
    next_attempt_at >= created_at
    and (last_attempted_at is null or last_attempted_at >= created_at)
  );

alter table channel_provider_deliveries
  drop constraint if exists channel_provider_deliveries_lease_valid;
alter table channel_provider_deliveries
  add constraint channel_provider_deliveries_lease_valid check (
    (lease_id is null and lease_expires_at is null)
    or (
      lease_id is not null
      and char_length(lease_id) between 8 and 160
      and lease_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
      and lease_expires_at is not null
      and last_attempted_at is not null
      and lease_expires_at > last_attempted_at
      and status in ('reserved', 'failed')
      and attempts > 0
      and attempts <= max_attempts
    )
  );

create or replace function protect_channel_provider_delivery_identity()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id <> old.tenant_id
     or new.provider <> old.provider
     or new.endpoint_id <> old.endpoint_id
     or new.message_id <> old.message_id
     or new.channel_identity_id <> old.channel_identity_id
     or new.idempotency_key <> old.idempotency_key
     or new.request_fingerprint <> old.request_fingerprint
     or new.max_attempts <> old.max_attempts
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'channel_provider_delivery_identity_immutable';
  end if;
  return new;
end;
$$;

create index if not exists idx_channel_provider_deliveries_tenant_retry
  on channel_provider_deliveries (
    tenant_id, provider, next_attempt_at, status, lease_expires_at
  );
