create table if not exists channel_provider_identity_bindings (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  provider text not null,
  endpoint_id text not null,
  channel_identity_id text not null,
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, provider, channel_identity_id),
  foreign key (tenant_id, endpoint_id, provider)
    references channel_provider_endpoints (tenant_id, id, provider)
    on delete restrict,
  foreign key (tenant_id, channel_identity_id)
    references conversation_channel_identities (tenant_id, id)
    on delete restrict,
  check (char_length(id) between 1 and 160),
  check (provider = 'whatsapp_meta'),
  check (char_length(endpoint_id) between 1 and 160),
  check (char_length(channel_identity_id) between 1 and 160)
);

create or replace function protect_channel_provider_identity_binding()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id <> old.tenant_id
     or new.provider <> old.provider
     or new.endpoint_id <> old.endpoint_id
     or new.channel_identity_id <> old.channel_identity_id
     or new.created_at <> old.created_at then
    raise exception 'channel_provider_identity_binding_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists channel_provider_identity_bindings_protect_identity
  on channel_provider_identity_bindings;
create trigger channel_provider_identity_bindings_protect_identity
before update on channel_provider_identity_bindings
for each row execute function protect_channel_provider_identity_binding();

create index if not exists idx_channel_provider_identity_bindings_tenant_endpoint
  on channel_provider_identity_bindings (
    tenant_id, provider, endpoint_id, channel_identity_id
  );
