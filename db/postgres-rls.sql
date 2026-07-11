-- Production hardening draft for PostgreSQL.
alter table contacts enable row level security;
alter table leads enable row level security;
alter table tasks enable row level security;
alter table activities enable row level security;
alter table websites enable row level security;
alter table website_sections enable row level security;
alter table audit_logs enable row level security;

-- App must set: select set_config('app.tenant_id', '<tenant-id>', true);
create policy tenant_contacts on contacts
  using (tenant_id = current_setting('app.tenant_id', true));
create policy tenant_leads on leads
  using (tenant_id = current_setting('app.tenant_id', true));
create policy tenant_tasks on tasks
  using (tenant_id = current_setting('app.tenant_id', true));
create policy tenant_activities on activities
  using (tenant_id = current_setting('app.tenant_id', true));
create policy tenant_websites on websites
  using (tenant_id = current_setting('app.tenant_id', true));
create policy tenant_website_sections on website_sections
  using (tenant_id = current_setting('app.tenant_id', true));
create policy tenant_audit_logs on audit_logs
  using (tenant_id = current_setting('app.tenant_id', true));
