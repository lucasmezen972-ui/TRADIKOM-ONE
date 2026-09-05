alter table channel_provider_secret_versions
  drop constraint if exists channel_provider_secret_versions_provider_check;

alter table channel_provider_secret_versions
  add constraint channel_provider_secret_versions_provider_check
  check (provider in ('whatsapp_twilio', 'whatsapp_meta'));

alter table channel_provider_secret_versions
  drop constraint if exists channel_provider_secret_versions_tenant_id_endpoint_id_fkey;

alter table channel_provider_secret_versions
  add constraint channel_provider_secret_versions_endpoint_provider_fkey
  foreign key (tenant_id, endpoint_id, provider)
  references channel_provider_endpoints (tenant_id, id, provider)
  on delete cascade;
