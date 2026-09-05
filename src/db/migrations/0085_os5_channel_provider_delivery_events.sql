do $$
declare
  status_constraint text;
begin
  for status_constraint in
    select conname
    from pg_constraint
    where conrelid = 'channel_provider_deliveries'::regclass
      and contype = 'c'
      and position('EXTERNAL_MESSAGE_ID' in upper(pg_get_constraintdef(oid))) > 0
      and position('FAILURE_CLASSIFICATION' in upper(pg_get_constraintdef(oid))) > 0
      and position('RETRYABLE' in upper(pg_get_constraintdef(oid))) > 0
  loop
    execute format(
      'alter table channel_provider_deliveries drop constraint %I',
      status_constraint
    );
  end loop;
end;
$$;

alter table channel_provider_deliveries
  drop constraint if exists channel_provider_deliveries_status_payload_valid;
alter table channel_provider_deliveries
  add constraint channel_provider_deliveries_status_payload_valid check (
    (status = 'reserved'
      and external_message_id is null
      and failure_classification is null
      and safe_error_code is null
      and retryable is null)
    or (status in ('accepted', 'delivered')
      and external_message_id is not null
      and failure_classification is null
      and safe_error_code is null
      and retryable = false)
    or (status = 'failed'
      and failure_classification is not null
      and safe_error_code is not null
      and retryable is not null
      and (
        external_message_id is null
        or (
          external_message_id is not null
          and failure_classification = 'permanent'
          and safe_error_code = 'provider_delivery_failed'
          and retryable = false
        )
      ))
    or (status = 'denied'
      and external_message_id is null
      and failure_classification is not null
      and safe_error_code is not null
      and retryable is not null)
  );

create unique index if not exists uq_channel_provider_deliveries_provider_external
  on channel_provider_deliveries (provider, external_message_id)
  where external_message_id is not null;

create table if not exists channel_provider_delivery_events (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  delivery_id text not null,
  provider text not null,
  event_key text not null,
  status text not null,
  safe_error_code text,
  received_at text not null,
  unique (tenant_id, id),
  unique (provider, event_key),
  foreign key (tenant_id, delivery_id)
    references channel_provider_deliveries(tenant_id, id) on delete restrict,
  check (char_length(id) between 1 and 160),
  check (provider = 'whatsapp_twilio'),
  check (event_key ~ '^[a-f0-9]{64}$'),
  check (status in ('accepted', 'delivered', 'failed')),
  check (
    (status in ('accepted', 'delivered') and safe_error_code is null)
    or (status = 'failed' and safe_error_code = 'provider_delivery_failed')
  )
);

create or replace function reject_channel_provider_delivery_event_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'channel_provider_delivery_event_immutable';
end;
$$;

drop trigger if exists channel_provider_delivery_events_immutable
  on channel_provider_delivery_events;
create trigger channel_provider_delivery_events_immutable
before update on channel_provider_delivery_events
for each row execute function reject_channel_provider_delivery_event_update();

create index if not exists idx_channel_provider_delivery_events_tenant_delivery
  on channel_provider_delivery_events (tenant_id, delivery_id, received_at, id);
