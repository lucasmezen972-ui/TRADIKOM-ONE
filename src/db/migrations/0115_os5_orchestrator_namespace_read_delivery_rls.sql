drop policy if exists conversation_messages_orchestrator_namespace_select
  on conversation_messages;
create policy conversation_messages_orchestrator_namespace_select
  on conversation_messages as restrictive for select to public
  using (
    app_is_system()
    or (
      idempotency_key !~ '^orchestrator:'
      and adapter_key <> 'orchestrator-mock'
      and channel_identity_id !~ '^orchestrator_identity_'
    )
  );

alter table channel_provider_deliveries
  add column if not exists internal_conversation_target boolean;

update channel_provider_deliveries delivery
set internal_conversation_target =
  is_internal_conversation_message(delivery.tenant_id, delivery.message_id)
  or is_internal_conversation_identity(
    delivery.tenant_id,
    delivery.channel_identity_id
  );

alter table channel_provider_deliveries
  alter column internal_conversation_target set not null;

comment on column channel_provider_deliveries.internal_conversation_target is
  'Classification immuable du rattachement à une preuve Conversation interne.';

create or replace function classify_channel_provider_delivery_target()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  new.internal_conversation_target :=
    is_internal_conversation_message(new.tenant_id, new.message_id)
    or is_internal_conversation_identity(
      new.tenant_id,
      new.channel_identity_id
    );
  return new;
end;
$$;

drop trigger if exists channel_provider_deliveries_classify_target
  on channel_provider_deliveries;
create trigger channel_provider_deliveries_classify_target
before insert on channel_provider_deliveries
for each row execute function classify_channel_provider_delivery_target();

create or replace function protect_channel_provider_delivery_identity()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
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
     or new.created_at <> old.created_at
     or new.internal_conversation_target <>
       old.internal_conversation_target then
    raise exception 'channel_provider_delivery_identity_immutable';
  end if;
  return new;
end;
$$;

drop policy if exists channel_provider_deliveries_internal_conversation_select
  on channel_provider_deliveries;
create policy channel_provider_deliveries_internal_conversation_select
  on channel_provider_deliveries as restrictive for select to public
  using (
    app_is_system()
    or not internal_conversation_target
  );

drop policy if exists channel_provider_deliveries_internal_conversation_update
  on channel_provider_deliveries;
create policy channel_provider_deliveries_internal_conversation_update
  on channel_provider_deliveries as restrictive for update to public
  using (
    app_is_system()
    or not internal_conversation_target
  )
  with check (
    app_is_system()
    or not internal_conversation_target
  );

drop policy if exists channel_provider_deliveries_internal_conversation_delete
  on channel_provider_deliveries;
create policy channel_provider_deliveries_internal_conversation_delete
  on channel_provider_deliveries as restrictive for delete to public
  using (
    app_is_system()
    or not internal_conversation_target
  );
