create table if not exists channel_provider_deliveries (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  provider text not null,
  endpoint_id text not null,
  message_id text not null,
  channel_identity_id text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  status text not null,
  external_message_id text,
  failure_classification text,
  safe_error_code text,
  retryable boolean,
  created_by text not null references users(id) on delete restrict,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, provider, idempotency_key),
  foreign key (tenant_id, endpoint_id)
    references channel_provider_endpoints(tenant_id, id) on delete restrict,
  foreign key (tenant_id, message_id)
    references conversation_messages(tenant_id, id) on delete restrict,
  foreign key (tenant_id, channel_identity_id)
    references conversation_channel_identities(tenant_id, id) on delete restrict,
  check (char_length(id) between 1 and 160),
  check (provider = 'whatsapp_twilio'),
  check (char_length(endpoint_id) between 1 and 160),
  check (char_length(message_id) between 1 and 160),
  check (char_length(channel_identity_id) between 1 and 160),
  check (char_length(idempotency_key) between 8 and 160),
  check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  check (status in ('reserved', 'accepted', 'delivered', 'failed', 'denied')),
  check (
    external_message_id is null
    or (
      char_length(external_message_id) between 1 and 256
      and external_message_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  check (
    failure_classification is null
    or failure_classification in (
      'temporary', 'permanent', 'auth', 'rate_limit', 'policy',
      'validation', 'not_configured'
    )
  ),
  check (
    safe_error_code is null
    or (
      char_length(safe_error_code) between 1 and 160
      and safe_error_code ~ '^[a-z][a-z0-9_]*$'
    )
  ),
  check (
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
    or (status in ('failed', 'denied')
      and external_message_id is null
      and failure_classification is not null
      and safe_error_code is not null
      and retryable is not null)
  ),
  check (char_length(created_by) between 1 and 160),
  check (updated_at >= created_at)
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
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'channel_provider_delivery_identity_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists channel_provider_deliveries_protect_identity
  on channel_provider_deliveries;
create trigger channel_provider_deliveries_protect_identity
before update on channel_provider_deliveries
for each row execute function protect_channel_provider_delivery_identity();

create index if not exists idx_channel_provider_deliveries_tenant_message
  on channel_provider_deliveries (tenant_id, message_id, created_at desc);
create index if not exists idx_channel_provider_deliveries_tenant_status
  on channel_provider_deliveries (tenant_id, provider, status, updated_at desc);
