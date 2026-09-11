alter table channel_provider_endpoints
  drop constraint if exists channel_provider_endpoints_provider_check;

alter table channel_provider_endpoints
  add constraint channel_provider_endpoints_provider_check check (provider in (
    'whatsapp_twilio',
    'whatsapp_meta',
    'teams_microsoft',
    'slack',
    'email_resend'
  ));
