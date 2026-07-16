alter table products enable row level security;

drop policy if exists tenant_isolation on products;
create policy tenant_isolation on products
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
