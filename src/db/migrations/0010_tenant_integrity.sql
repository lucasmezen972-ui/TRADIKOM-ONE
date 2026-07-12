-- Enforce same-tenant relations and tenant-read indexes.

create or replace function app_enforce_related_tenant()
returns trigger
language plpgsql
as $$
declare
  related_id text;
  related_tenant_id text;
begin
  related_id := to_jsonb(new) ->> tg_argv[1];
  if related_id is null or related_id = '' then
    return new;
  end if;

  execute format(
    'select tenant_id from public.%I where id = $1',
    tg_argv[0]
  ) into related_tenant_id using related_id;

  if related_tenant_id is null then
    raise exception using errcode = '23503', message = 'Related tenant row not found.';
  end if;
  if related_tenant_id <> new.tenant_id then
    raise exception using errcode = '23514', message = 'Cross-tenant relation rejected.';
  end if;
  return new;
end
$$;

drop trigger if exists pipeline_stages_tenant_integrity on pipeline_stages;
create trigger pipeline_stages_tenant_integrity before insert or update of tenant_id, pipeline_id on pipeline_stages for each row execute function app_enforce_related_tenant('pipelines', 'pipeline_id');
drop trigger if exists contact_consents_tenant_integrity on contact_consents;
create trigger contact_consents_tenant_integrity before insert or update of tenant_id, contact_id on contact_consents for each row execute function app_enforce_related_tenant('contacts', 'contact_id');
drop trigger if exists opportunities_contact_tenant_integrity on opportunities;
create trigger opportunities_contact_tenant_integrity before insert or update of tenant_id, contact_id on opportunities for each row execute function app_enforce_related_tenant('contacts', 'contact_id');
drop trigger if exists opportunities_stage_tenant_integrity on opportunities;
create trigger opportunities_stage_tenant_integrity before insert or update of tenant_id, stage_id on opportunities for each row execute function app_enforce_related_tenant('pipeline_stages', 'stage_id');
drop trigger if exists leads_tenant_integrity on leads;
create trigger leads_tenant_integrity before insert or update of tenant_id, contact_id on leads for each row execute function app_enforce_related_tenant('contacts', 'contact_id');
drop trigger if exists website_pages_tenant_integrity on website_pages;
create trigger website_pages_tenant_integrity before insert or update of tenant_id, website_id on website_pages for each row execute function app_enforce_related_tenant('websites', 'website_id');
drop trigger if exists website_sections_tenant_integrity on website_sections;
create trigger website_sections_tenant_integrity before insert or update of tenant_id, website_id on website_sections for each row execute function app_enforce_related_tenant('websites', 'website_id');
drop trigger if exists website_versions_tenant_integrity on website_versions;
create trigger website_versions_tenant_integrity before insert or update of tenant_id, website_id on website_versions for each row execute function app_enforce_related_tenant('websites', 'website_id');
drop trigger if exists websites_draft_tenant_integrity on websites;
create trigger websites_draft_tenant_integrity before insert or update of tenant_id, current_draft_version_id on websites for each row execute function app_enforce_related_tenant('website_versions', 'current_draft_version_id');
drop trigger if exists websites_published_tenant_integrity on websites;
create trigger websites_published_tenant_integrity before insert or update of tenant_id, current_published_version_id on websites for each row execute function app_enforce_related_tenant('website_versions', 'current_published_version_id');
drop trigger if exists website_publications_website_tenant_integrity on website_publications;
create trigger website_publications_website_tenant_integrity before insert or update of tenant_id, website_id on website_publications for each row execute function app_enforce_related_tenant('websites', 'website_id');
drop trigger if exists website_publications_version_tenant_integrity on website_publications;
create trigger website_publications_version_tenant_integrity before insert or update of tenant_id, version_id on website_publications for each row execute function app_enforce_related_tenant('website_versions', 'version_id');
drop trigger if exists forms_tenant_integrity on forms;
create trigger forms_tenant_integrity before insert or update of tenant_id, website_id on forms for each row execute function app_enforce_related_tenant('websites', 'website_id');
drop trigger if exists form_fields_tenant_integrity on form_fields;
create trigger form_fields_tenant_integrity before insert or update of tenant_id, form_id on form_fields for each row execute function app_enforce_related_tenant('forms', 'form_id');
drop trigger if exists form_submissions_form_tenant_integrity on form_submissions;
create trigger form_submissions_form_tenant_integrity before insert or update of tenant_id, form_id on form_submissions for each row execute function app_enforce_related_tenant('forms', 'form_id');
drop trigger if exists form_submissions_website_tenant_integrity on form_submissions;
create trigger form_submissions_website_tenant_integrity before insert or update of tenant_id, website_id on form_submissions for each row execute function app_enforce_related_tenant('websites', 'website_id');
drop trigger if exists form_submissions_contact_tenant_integrity on form_submissions;
create trigger form_submissions_contact_tenant_integrity before insert or update of tenant_id, created_contact_id on form_submissions for each row execute function app_enforce_related_tenant('contacts', 'created_contact_id');
drop trigger if exists workflow_run_steps_tenant_integrity on workflow_run_steps;
create trigger workflow_run_steps_tenant_integrity before insert or update of tenant_id, workflow_run_id on workflow_run_steps for each row execute function app_enforce_related_tenant('workflow_runs', 'workflow_run_id');
drop trigger if exists webhook_deliveries_tenant_integrity on webhook_deliveries;
create trigger webhook_deliveries_tenant_integrity before insert or update of tenant_id, webhook_endpoint_id on webhook_deliveries for each row execute function app_enforce_related_tenant('webhook_endpoints', 'webhook_endpoint_id');
drop trigger if exists import_rows_tenant_integrity on import_rows;
create trigger import_rows_tenant_integrity before insert or update of tenant_id, import_id on import_rows for each row execute function app_enforce_related_tenant('imports', 'import_id');

do $$
declare
  tenant_table record;
  has_tenant_index boolean;
begin
  for tenant_table in
    select columns.table_name
    from information_schema.columns as columns
    where columns.table_schema = 'public' and columns.column_name = 'tenant_id'
  loop
    select exists (
      select 1 from pg_index as indexes
      join pg_attribute as attributes
        on attributes.attrelid = indexes.indrelid
       and attributes.attnum = any(indexes.indkey)
      where indexes.indrelid = format('public.%I', tenant_table.table_name)::regclass
        and attributes.attname = 'tenant_id'
    ) into has_tenant_index;
    if not has_tenant_index then
      execute format('create index %I on public.%I (tenant_id)', 'idx_' || tenant_table.table_name || '_tenant_scope', tenant_table.table_name);
    end if;
  end loop;
end
$$;
