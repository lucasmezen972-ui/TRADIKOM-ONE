alter table private_marketplace_listings enable row level security;
alter table marketplace_installation_previews enable row level security;

drop policy if exists tenant_isolation on private_marketplace_listings;
create policy tenant_isolation on private_marketplace_listings
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on marketplace_installation_previews;
create policy tenant_isolation on marketplace_installation_previews
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
