alter table channel_provider_activation_authorizations
  add constraint channel_provider_activation_authorizations_budget_reference
  unique (tenant_id, id, provider, endpoint_id);

alter table channel_provider_deliveries
  add constraint channel_provider_deliveries_budget_reference
  unique (tenant_id, id, provider, endpoint_id);

create table if not exists channel_provider_activation_consumptions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  provider text not null,
  endpoint_id text not null,
  authorization_id text not null,
  delivery_id text not null,
  consumed_by text not null references users(id) on delete restrict,
  consumed_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, provider, delivery_id),
  foreign key (tenant_id, authorization_id, provider, endpoint_id)
    references channel_provider_activation_authorizations(
      tenant_id, id, provider, endpoint_id
    ) on delete restrict,
  foreign key (tenant_id, delivery_id, provider, endpoint_id)
    references channel_provider_deliveries(
      tenant_id, id, provider, endpoint_id
    ) on delete restrict,
  check (char_length(id) between 1 and 160),
  check (provider = 'whatsapp_twilio'),
  check (char_length(endpoint_id) between 1 and 160),
  check (char_length(authorization_id) between 1 and 160),
  check (char_length(delivery_id) between 1 and 160),
  check (char_length(consumed_by) between 1 and 160)
);

create index if not exists idx_channel_provider_activation_consumptions_tenant
  on channel_provider_activation_consumptions (
    tenant_id, authorization_id, consumed_at, id
  );

create or replace function enforce_channel_provider_activation_budget()
returns trigger
language plpgsql
as $$
declare
  authorization_max integer;
  authorization_start timestamptz;
  authorization_expiry timestamptz;
  authorization_revoked text;
  consumed_count integer;
begin
  select max_messages, authorized_at::timestamptz, expires_at::timestamptz,
         revoked_at
    into authorization_max, authorization_start, authorization_expiry,
         authorization_revoked
  from channel_provider_activation_authorizations
  where tenant_id = new.tenant_id
    and id = new.authorization_id
    and provider = new.provider
    and endpoint_id = new.endpoint_id
  for update;

  if authorization_max is null
     or authorization_revoked is not null
     or new.consumed_at::timestamptz < authorization_start
     or new.consumed_at::timestamptz >= authorization_expiry then
    raise exception 'channel_provider_activation_budget_invalid';
  end if;

  select count(*)::integer into consumed_count
  from channel_provider_activation_consumptions
  where tenant_id = new.tenant_id
    and authorization_id = new.authorization_id;

  if consumed_count >= authorization_max then
    raise exception 'channel_provider_activation_budget_exhausted';
  end if;
  return new;
end;
$$;

drop trigger if exists channel_provider_activation_consumptions_budget
  on channel_provider_activation_consumptions;
create trigger channel_provider_activation_consumptions_budget
before insert on channel_provider_activation_consumptions
for each row execute function enforce_channel_provider_activation_budget();

create or replace function reject_channel_provider_activation_consumption_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'channel_provider_activation_consumption_immutable';
end;
$$;

drop trigger if exists channel_provider_activation_consumptions_immutable
  on channel_provider_activation_consumptions;
create trigger channel_provider_activation_consumptions_immutable
before update on channel_provider_activation_consumptions
for each row execute function reject_channel_provider_activation_consumption_update();
