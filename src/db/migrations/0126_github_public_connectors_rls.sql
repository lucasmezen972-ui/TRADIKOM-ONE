alter table github_public_connectors enable row level security;
drop policy if exists tenant_isolation on github_public_connectors;
drop policy if exists github_public_connector_read on github_public_connectors;
create policy github_public_connector_read on github_public_connectors for select using (
  app_is_system() or (tenant_id = app_current_tenant_id() and nullif(current_setting('app.actor_id', true), '') is not null
    and exists (select 1 from memberships m where m.tenant_id = github_public_connectors.tenant_id and m.user_id = nullif(current_setting('app.actor_id', true), '')))
);
drop policy if exists github_public_connector_insert on github_public_connectors;
create policy github_public_connector_insert on github_public_connectors for insert with check (app_is_system());
drop policy if exists github_public_connector_update on github_public_connectors;
create policy github_public_connector_update on github_public_connectors for update using (app_is_system()) with check (app_is_system());
