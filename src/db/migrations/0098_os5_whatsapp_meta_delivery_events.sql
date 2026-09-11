create unique index if not exists uq_channel_provider_deliveries_tenant_id_provider
  on channel_provider_deliveries (tenant_id, id, provider);

alter table channel_provider_deliveries
  drop constraint if exists channel_provider_deliveries_external_message_id_check;

alter table channel_provider_deliveries
  add constraint channel_provider_deliveries_external_message_id_check check (
    external_message_id is null
    or (
      char_length(external_message_id) between 1 and 256
      and (
        (provider = 'whatsapp_twilio'
          and external_message_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$')
        or (provider = 'whatsapp_meta'
          and external_message_id ~ '^wamid[.][-A-Za-z0-9._:+/=]+$')
      )
    )
  );

alter table channel_provider_delivery_events
  drop constraint if exists channel_provider_delivery_events_provider_check;

alter table channel_provider_delivery_events
  add constraint channel_provider_delivery_events_provider_check
  check (provider in ('whatsapp_twilio', 'whatsapp_meta'));

alter table channel_provider_delivery_events
  drop constraint if exists channel_provider_delivery_events_tenant_id_delivery_id_fkey;

alter table channel_provider_delivery_events
  add constraint channel_provider_delivery_events_delivery_provider_fkey
  foreign key (tenant_id, delivery_id, provider)
  references channel_provider_deliveries (tenant_id, id, provider)
  on delete restrict;
