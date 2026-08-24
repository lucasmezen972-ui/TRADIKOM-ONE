alter table approvals add column if not exists snoozed_until text;
alter table approvals add column if not exists snoozed_by text references users(id);
alter table approvals add column if not exists snooze_reason text;

create index if not exists idx_approvals_tenant_status_snoozed
  on approvals (tenant_id, status, snoozed_until);
