alter table email_suppressions enable row level security;

drop policy if exists tenant_isolation on email_suppressions;
create policy tenant_isolation on email_suppressions
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
