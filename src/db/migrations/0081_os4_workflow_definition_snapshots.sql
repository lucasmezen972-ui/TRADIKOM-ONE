alter table workflow_runs
  add column if not exists definition_snapshot text;
alter table workflow_runs
  add column if not exists definition_version integer;

alter table workflow_runs
  drop constraint if exists workflow_runs_definition_snapshot_pair;
alter table workflow_runs
  add constraint workflow_runs_definition_snapshot_pair check (
    (definition_snapshot is null and definition_version is null)
    or (
      definition_snapshot is not null
      and definition_version is not null
      and definition_version between 1 and 1000000
      and char_length(definition_snapshot) between 2 and 65536
    )
  );

create or replace function protect_workflow_run_definition_snapshot()
returns trigger
language plpgsql
as $$
begin
  if new.definition_snapshot is distinct from old.definition_snapshot
     or new.definition_version is distinct from old.definition_version then
    raise exception 'workflow_run_definition_snapshot_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists workflow_runs_protect_definition_snapshot
  on workflow_runs;
create trigger workflow_runs_protect_definition_snapshot
before update on workflow_runs
for each row execute function protect_workflow_run_definition_snapshot();

create index if not exists idx_workflow_runs_tenant_definition_version
  on workflow_runs (tenant_id, definition_version, created_at desc);
