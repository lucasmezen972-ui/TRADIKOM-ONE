alter table channel_provider_activation_consumptions enable row level security;

drop policy if exists tenant_isolation on channel_provider_activation_consumptions;
create policy tenant_isolation on channel_provider_activation_consumptions
  for all
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
