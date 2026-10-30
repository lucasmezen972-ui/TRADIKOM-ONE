alter table email_provider_deliveries enable row level security;
alter table email_provider_events enable row level security;

drop policy if exists tenant_isolation on email_provider_deliveries;
create policy tenant_isolation on email_provider_deliveries
  for all
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on email_provider_events;
create policy tenant_isolation on email_provider_events
  for all
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
