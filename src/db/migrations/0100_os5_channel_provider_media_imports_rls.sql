alter table channel_provider_media_imports enable row level security;

drop policy if exists tenant_isolation on channel_provider_media_imports;
create policy tenant_isolation on channel_provider_media_imports
  for all
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
