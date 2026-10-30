alter table conversation_thread_access_grants enable row level security;
alter table conversation_thread_access_operations enable row level security;

drop policy if exists tenant_isolation on conversation_thread_access_grants;
drop policy if exists conversation_thread_access_grants_select
  on conversation_thread_access_grants;
create policy conversation_thread_access_grants_select
  on conversation_thread_access_grants for select
  using (
    app_is_system()
    or (
      tenant_id = app_current_tenant_id()
      and (
        user_id = nullif(current_setting('app.actor_id', true), '')
        or exists (
          select 1 from memberships actor_membership
          where actor_membership.tenant_id = conversation_thread_access_grants.tenant_id
            and actor_membership.user_id = nullif(current_setting('app.actor_id', true), '')
            and actor_membership.role in ('owner', 'administrator')
        )
      )
    )
  );
drop policy if exists conversation_thread_access_grants_insert
  on conversation_thread_access_grants;
create policy conversation_thread_access_grants_insert
  on conversation_thread_access_grants for insert
  with check (
    app_is_system()
    or (
      tenant_id = app_current_tenant_id()
      and granted_by_user_id = nullif(current_setting('app.actor_id', true), '')
      and exists (
        select 1 from memberships actor_membership
        where actor_membership.tenant_id = conversation_thread_access_grants.tenant_id
          and actor_membership.user_id = nullif(current_setting('app.actor_id', true), '')
          and actor_membership.role in ('owner', 'administrator')
      )
    )
  );
drop policy if exists conversation_thread_access_grants_update
  on conversation_thread_access_grants;
create policy conversation_thread_access_grants_update
  on conversation_thread_access_grants for update
  using (app_is_system())
  with check (app_is_system());
drop policy if exists conversation_thread_access_grants_delete
  on conversation_thread_access_grants;
create policy conversation_thread_access_grants_delete
  on conversation_thread_access_grants for delete
  using (
    app_is_system()
    or (
      tenant_id = app_current_tenant_id()
      and exists (
        select 1 from memberships actor_membership
        where actor_membership.tenant_id = conversation_thread_access_grants.tenant_id
          and actor_membership.user_id = nullif(current_setting('app.actor_id', true), '')
          and actor_membership.role in ('owner', 'administrator')
      )
    )
  );

drop policy if exists tenant_isolation on conversation_thread_access_operations;
drop policy if exists conversation_thread_access_operations_select
  on conversation_thread_access_operations;
create policy conversation_thread_access_operations_select
  on conversation_thread_access_operations for select
  using (
    app_is_system()
    or (
      tenant_id = app_current_tenant_id()
      and exists (
        select 1 from memberships actor_membership
        where actor_membership.tenant_id = conversation_thread_access_operations.tenant_id
          and actor_membership.user_id = nullif(current_setting('app.actor_id', true), '')
          and actor_membership.role in ('owner', 'administrator')
      )
    )
  );
drop policy if exists conversation_thread_access_operations_insert
  on conversation_thread_access_operations;
create policy conversation_thread_access_operations_insert
  on conversation_thread_access_operations for insert
  with check (
    app_is_system()
    or (
      tenant_id = app_current_tenant_id()
      and requested_by_user_id = nullif(current_setting('app.actor_id', true), '')
      and exists (
        select 1 from memberships actor_membership
        where actor_membership.tenant_id = conversation_thread_access_operations.tenant_id
          and actor_membership.user_id = nullif(current_setting('app.actor_id', true), '')
          and actor_membership.role in ('owner', 'administrator')
      )
    )
  );
drop policy if exists conversation_thread_access_operations_update
  on conversation_thread_access_operations;
create policy conversation_thread_access_operations_update
  on conversation_thread_access_operations for update
  using (app_is_system())
  with check (app_is_system());
drop policy if exists conversation_thread_access_operations_delete
  on conversation_thread_access_operations;
create policy conversation_thread_access_operations_delete
  on conversation_thread_access_operations for delete
  using (app_is_system());
