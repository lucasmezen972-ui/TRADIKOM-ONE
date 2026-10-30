do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'channel_activation_auth_endpoint_fkey'
      and conrelid = 'channel_provider_activation_authorizations'::regclass
  ) then
    alter table channel_provider_activation_authorizations
      add constraint channel_activation_auth_endpoint_fkey
      foreign key (tenant_id, endpoint_id, provider)
      references channel_provider_endpoints (tenant_id, id, provider)
      on delete cascade;
  end if;

alter table channel_provider_activation_authorizations
  drop constraint if exists channel_provider_activation_authoriz_tenant_id_endpoint_id_fkey;

alter table channel_provider_activation_authorizations
  drop constraint if exists channel_provider_activation_authorizations_provider_check;
alter table channel_provider_activation_authorizations
  add constraint channel_provider_activation_authorizations_provider_check
  check (provider in ('whatsapp_twilio', 'whatsapp_meta'));

alter table channel_provider_activation_authorizations
  drop constraint if exists channel_provider_activation_authorizations_authorization_scope_check;
alter table channel_provider_activation_authorizations
  drop constraint if exists channel_provider_activation_authoriza_authorization_scope_check;
alter table channel_provider_activation_authorizations
  drop constraint if exists channel_activation_auth_scope_check;
alter table channel_provider_activation_authorizations
  add constraint channel_activation_auth_scope_check
  check (
    (provider = 'whatsapp_twilio'
      and authorization_scope = 'twilio_whatsapp_sandbox')
    or (provider = 'whatsapp_meta'
      and authorization_scope = 'meta_whatsapp_trial')
  );

alter table channel_provider_activation_authorizations
  drop constraint if exists channel_provider_activation_authorizations_max_messages_check;
alter table channel_provider_activation_authorizations
  add constraint channel_provider_activation_authorizations_max_messages_check
  check (
    (provider = 'whatsapp_twilio' and max_messages between 1 and 2)
    or (provider = 'whatsapp_meta' and max_messages = 1)
  );

alter table channel_provider_activation_consumptions
  drop constraint if exists channel_provider_activation_consumptions_provider_check;
alter table channel_provider_activation_consumptions
  add constraint channel_provider_activation_consumptions_provider_check
  check (provider in ('whatsapp_twilio', 'whatsapp_meta'));

  alter table channel_provider_deliveries
    add column if not exists activation_authorization_id text;

  update channel_provider_deliveries delivery
     set activation_authorization_id = consumption.authorization_id
    from channel_provider_activation_consumptions consumption
   where delivery.tenant_id = consumption.tenant_id
     and delivery.id = consumption.delivery_id
     and delivery.provider = consumption.provider
     and delivery.endpoint_id = consumption.endpoint_id
     and delivery.provider = 'whatsapp_meta'
     and delivery.activation_authorization_id is null;

  with terminalized_deliveries as (
    update channel_provider_deliveries
       set status = 'denied',
           failure_classification = 'policy',
           safe_error_code = 'meta_trial_authorization_required',
           retryable = false,
           lease_id = null,
           lease_expires_at = null
     where provider = 'whatsapp_meta'
       and activation_authorization_id is null
       and (
         status = 'reserved'
         or (status = 'failed' and retryable = true)
       )
     returning tenant_id, message_id
  )
  update conversation_messages message
     set status = 'failed',
         safe_error_code = 'meta_trial_authorization_required'
    from terminalized_deliveries delivery
   where message.tenant_id = delivery.tenant_id
     and message.id = delivery.message_id
     and message.status in ('pending', 'failed');

  alter table channel_provider_deliveries
    drop constraint if exists channel_delivery_activation_auth_id_check;
  alter table channel_provider_deliveries
    add constraint channel_delivery_activation_auth_id_check
    check (
      activation_authorization_id is null
      or char_length(activation_authorization_id) between 1 and 160
    );

  alter table channel_provider_deliveries
    drop constraint if exists channel_delivery_activation_auth_fkey;
  alter table channel_provider_deliveries
    add constraint channel_delivery_activation_auth_fkey
    foreign key (
      tenant_id, activation_authorization_id, provider, endpoint_id
    )
    references channel_provider_activation_authorizations (
      tenant_id, id, provider, endpoint_id
    )
    on delete restrict;

  execute $function_sql$
    create or replace function protect_channel_delivery_activation_authorization()
    returns trigger
    language plpgsql
    as $function_body$
    begin
      if new.activation_authorization_id is distinct from old.activation_authorization_id then
        raise exception 'channel_provider_delivery_activation_authorization_immutable';
      end if;
      return new;
    end;
    $function_body$
  $function_sql$;

  drop trigger if exists channel_provider_deliveries_protect_activation_auth
    on channel_provider_deliveries;
  create trigger channel_provider_deliveries_protect_activation_auth
  before update on channel_provider_deliveries
  for each row execute function protect_channel_delivery_activation_authorization();

  execute $function_sql$
    create or replace function enforce_meta_delivery_activation_authorization()
    returns trigger
    language plpgsql
    as $function_body$
    begin
      if new.provider = 'whatsapp_meta'
         and not exists (
           select 1 from channel_provider_deliveries delivery
           where delivery.tenant_id = new.tenant_id
             and delivery.id = new.delivery_id
             and delivery.provider = new.provider
             and delivery.endpoint_id = new.endpoint_id
             and delivery.activation_authorization_id = new.authorization_id
         ) then
        raise exception 'channel_provider_activation_budget_invalid';
      end if;
      return new;
    end;
    $function_body$
  $function_sql$;

  drop trigger if exists channel_provider_activation_consumptions_meta_delivery_auth
    on channel_provider_activation_consumptions;
  create trigger channel_provider_activation_consumptions_meta_delivery_auth
  before insert on channel_provider_activation_consumptions
  for each row execute function enforce_meta_delivery_activation_authorization();
end;
$$;
