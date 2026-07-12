-- PostgreSQL RLS policies for tenant-owned tables.

create or replace function app_current_tenant_id()
returns text
language sql
stable
as $$
  select nullif(current_setting('app.tenant_id', true), '')
$$;

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

alter table business_profiles enable row level security;
alter table knowledge_documents enable row level security;
alter table contacts enable row level security;
alter table companies enable row level security;
alter table contact_consents enable row level security;
alter table pipelines enable row level security;
alter table pipeline_stages enable row level security;
alter table opportunities enable row level security;
alter table leads enable row level security;
alter table activities enable row level security;
alter table notes enable row level security;
alter table tasks enable row level security;
alter table websites enable row level security;
alter table website_pages enable row level security;
alter table website_sections enable row level security;
alter table website_versions enable row level security;
alter table website_publications enable row level security;
alter table forms enable row level security;
alter table form_fields enable row level security;
alter table form_submissions enable row level security;
alter table workflows enable row level security;
alter table workflow_runs enable row level security;
alter table workflow_run_steps enable row level security;
alter table approvals enable row level security;
alter table connectors enable row level security;
alter table connector_accounts enable row level security;
alter table connector_credentials enable row level security;
alter table connector_sync_runs enable row level security;
alter table webhook_endpoints enable row level security;
alter table webhook_deliveries enable row level security;
alter table external_record_mappings enable row level security;
alter table imports enable row level security;
alter table import_rows enable row level security;
alter table notifications enable row level security;
alter table audit_logs enable row level security;
alter table domain_events enable row level security;
alter table generation_records enable row level security;
alter table connector_secret_versions enable row level security;

drop policy if exists tenant_business_profiles on business_profiles;
create policy tenant_business_profiles on business_profiles
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_contacts on contacts;
create policy tenant_contacts on contacts
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_leads on leads;
create policy tenant_leads on leads
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_tasks on tasks;
create policy tenant_tasks on tasks
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_websites on websites;
create policy tenant_websites on websites
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_website_sections on website_sections;
create policy tenant_website_sections on website_sections
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_website_versions on website_versions;
create policy tenant_website_versions on website_versions
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_workflows on workflows;
create policy tenant_workflows on workflows
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_workflow_runs on workflow_runs;
create policy tenant_workflow_runs on workflow_runs
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_connectors on connectors;
create policy tenant_connectors on connectors
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_webhook_endpoints on webhook_endpoints;
create policy tenant_webhook_endpoints on webhook_endpoints
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_audit_logs on audit_logs;
create policy tenant_audit_logs on audit_logs
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

-- Generic policy for remaining tenant-owned tables.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'knowledge_documents','companies','contact_consents','pipelines','pipeline_stages',
    'opportunities','activities','notes','website_pages','website_publications',
    'forms','form_fields','form_submissions','workflow_run_steps','approvals',
    'connector_accounts','connector_credentials','connector_sync_runs','webhook_deliveries',
    'external_record_mappings','imports','import_rows','notifications','domain_events',
    'generation_records','connector_secret_versions'
  ]
  loop
    execute format('drop policy if exists tenant_%I on %I', table_name, table_name);
    execute format(
      'create policy tenant_%I on %I using (app_is_system() or tenant_id = app_current_tenant_id()) with check (app_is_system() or tenant_id = app_current_tenant_id())',
      table_name,
      table_name
    );
  end loop;
end $$;
