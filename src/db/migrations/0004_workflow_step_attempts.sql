-- Persist richer workflow action attempt metadata on existing step records.

alter table workflow_run_steps add column if not exists attempts integer not null default 1;
alter table workflow_run_steps add column if not exists scheduled_at text;
alter table workflow_run_steps add column if not exists started_at text;
alter table workflow_run_steps add column if not exists completed_at text;
alter table workflow_run_steps add column if not exists error text;

create index if not exists idx_workflow_run_steps_attempts
  on workflow_run_steps(tenant_id, workflow_run_id, action_name, created_at desc);
