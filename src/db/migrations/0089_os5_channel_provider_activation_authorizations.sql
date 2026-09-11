create table if not exists channel_provider_activation_authorizations (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  provider text not null,
  endpoint_id text not null,
  authorization_scope text not null,
  max_messages integer not null,
  free_units_confirmed boolean not null,
  idempotency_key_hash text not null,
  authorized_by text not null references users(id) on delete restrict,
  authorized_at text not null,
  expires_at text not null,
  revoked_at text,
  revoked_by text references users(id) on delete restrict,
  unique (tenant_id, id),
  unique (tenant_id, provider, idempotency_key_hash),
  foreign key (tenant_id, endpoint_id)
    references channel_provider_endpoints(tenant_id, id) on delete cascade,
  check (char_length(id) between 1 and 160),
  check (provider = 'whatsapp_twilio'),
  check (char_length(endpoint_id) between 1 and 160),
  check (authorization_scope = 'twilio_whatsapp_sandbox'),
  check (max_messages between 1 and 2),
  check (free_units_confirmed = true),
  check (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  check (expires_at::timestamptz > authorized_at::timestamptz),
  check (
    (revoked_at is null and revoked_by is null)
    or (revoked_at is not null and revoked_by is not null
      and revoked_at::timestamptz >= authorized_at::timestamptz)
  )
);

create index if not exists idx_channel_provider_activation_authorizations_tenant
  on channel_provider_activation_authorizations (
    tenant_id, provider, endpoint_id, authorization_scope, expires_at
  );

create or replace function protect_channel_provider_activation_authorization()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id <> old.tenant_id
     or new.provider <> old.provider
     or new.endpoint_id <> old.endpoint_id
     or new.authorization_scope <> old.authorization_scope
     or new.max_messages <> old.max_messages
     or new.free_units_confirmed <> old.free_units_confirmed
     or new.idempotency_key_hash <> old.idempotency_key_hash
     or new.authorized_by <> old.authorized_by
     or new.authorized_at <> old.authorized_at
     or new.expires_at <> old.expires_at
     or (old.revoked_at is not null and (
       new.revoked_at is distinct from old.revoked_at
       or new.revoked_by is distinct from old.revoked_by
     ))
     or ((new.revoked_at is null) <> (new.revoked_by is null)) then
    raise exception 'channel_provider_activation_authorization_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists channel_provider_activation_authorizations_protect
  on channel_provider_activation_authorizations;
create trigger channel_provider_activation_authorizations_protect
before update on channel_provider_activation_authorizations
for each row execute function protect_channel_provider_activation_authorization();
