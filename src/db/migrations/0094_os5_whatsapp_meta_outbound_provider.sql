create unique index if not exists uq_channel_provider_endpoints_tenant_id_provider
  on channel_provider_endpoints (tenant_id, id, provider);

alter table channel_provider_deliveries
  drop constraint if exists channel_provider_deliveries_provider_check;

alter table channel_provider_deliveries
  add constraint channel_provider_deliveries_provider_check check (provider in (
    'whatsapp_twilio',
    'whatsapp_meta'
  ));

alter table channel_provider_deliveries
  drop constraint if exists channel_provider_deliveries_provider_endpoint_fkey;

alter table channel_provider_deliveries
  add constraint channel_provider_deliveries_provider_endpoint_fkey
  foreign key (tenant_id, endpoint_id, provider)
  references channel_provider_endpoints (tenant_id, id, provider)
  on delete restrict
  not valid;
