-- Complete tenant RLS coverage and prevent self-set system bypass.

create or replace function app_is_system()
returns boolean
language sql
stable
as $$
  select
    coalesce(nullif(current_setting('app.system_access', true), ''), 'false') = 'true'
    and pg_has_role(
      current_user,
      (select relowner from pg_class where oid = 'public.tenants'::regclass),
      'MEMBER'
    )
$$;

do $$
declare
  tenant_table record;
begin
  for tenant_table in
    select columns.table_name
    from information_schema.columns as columns
    where columns.table_schema = 'public'
      and columns.column_name = 'tenant_id'
  loop
    execute format(
      'alter table public.%I enable row level security',
      tenant_table.table_name
    );
    execute format(
      'drop policy if exists tenant_isolation on public.%I',
      tenant_table.table_name
    );
    execute format(
      'create policy tenant_isolation on public.%I using (app_is_system() or tenant_id = app_current_tenant_id()) with check (app_is_system() or tenant_id = app_current_tenant_id())',
      tenant_table.table_name
    );
  end loop;
end
$$;

alter table tenants enable row level security;
drop policy if exists tenant_isolation on tenants;
create policy tenant_isolation on tenants
  using (app_is_system() or id = app_current_tenant_id())
  with check (app_is_system() or id = app_current_tenant_id());
