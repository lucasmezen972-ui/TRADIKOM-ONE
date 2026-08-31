create table if not exists channel_provider_endpoints (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  provider text not null,
  external_account_id text not null,
  destination_fingerprint text not null,
  status text not null,
  created_by text not null references users(id) on delete restrict,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (provider, external_account_id, destination_fingerprint),
  check (char_length(id) between 1 and 160),
  check (provider in (
    'whatsapp_twilio',
    'teams_microsoft',
    'slack',
    'email_resend'
  )),
  check (char_length(external_account_id) between 1 and 256),
  check (external_account_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
  check (destination_fingerprint ~ '^[a-f0-9]{64}$'),
  check (status in ('active', 'disabled')),
  check (char_length(created_by) between 1 and 160),
  check (updated_at >= created_at)
);

create or replace function protect_channel_provider_endpoint_identity()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id <> old.tenant_id
     or new.provider <> old.provider
     or new.external_account_id <> old.external_account_id
     or new.destination_fingerprint <> old.destination_fingerprint
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'channel_provider_endpoints identity is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists channel_provider_endpoints_protect_identity
  on channel_provider_endpoints;
create trigger channel_provider_endpoints_protect_identity
before update on channel_provider_endpoints
for each row execute function protect_channel_provider_endpoint_identity();

create index if not exists idx_channel_provider_endpoints_tenant_provider
  on channel_provider_endpoints (tenant_id, provider, status, updated_at desc);
create index if not exists idx_channel_provider_endpoints_created_by
  on channel_provider_endpoints (created_by);
