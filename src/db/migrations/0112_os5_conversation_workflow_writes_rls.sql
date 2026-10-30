create or replace function app_is_conversation_policy_workflow(
  target_workflow_key text,
  target_trigger_name text,
  target_definition_snapshot text
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = public, pg_catalog
as $$
declare
  parsed_definition jsonb;
  parsed_action jsonb;
begin
  if coalesce(target_workflow_key, '') like 'conversation_plan:%'
     or target_trigger_name = 'conversation.plan.execute' then
    return true;
  end if;

  if target_definition_snapshot is null then
    return false;
  end if;

  begin
    parsed_definition := target_definition_snapshot::jsonb;
  exception when others then
    return true;
  end;

  if jsonb_typeof(parsed_definition) is distinct from 'object'
     or jsonb_typeof(parsed_definition -> 'key') is distinct from 'string'
     or nullif(parsed_definition ->> 'key', '') is null
     or jsonb_typeof(parsed_definition -> 'version') is distinct from 'number'
     or jsonb_typeof(parsed_definition -> 'trigger') is distinct from 'string'
     or nullif(parsed_definition ->> 'trigger', '') is null
     or jsonb_typeof(parsed_definition -> 'active') is distinct from 'boolean'
     or (
       parsed_definition ? 'conditions'
       and jsonb_typeof(parsed_definition -> 'conditions') is distinct from 'array'
     )
     or jsonb_typeof(parsed_definition -> 'actions') is distinct from 'array'
     or jsonb_array_length(parsed_definition -> 'actions') = 0
     or jsonb_typeof(parsed_definition -> 'retryPolicy') is distinct from 'object'
     or jsonb_typeof(
       parsed_definition #> '{retryPolicy,maxAttempts}'
     ) is distinct from 'number'
     or jsonb_typeof(
       parsed_definition #> '{retryPolicy,backoffMs}'
     ) is distinct from 'number'
     or jsonb_typeof(parsed_definition -> 'timeoutMs') is distinct from 'number'
     or coalesce(parsed_definition ->> 'approvalPolicy', '') not in (
       'no_approval_required',
       'user_approval_required',
       'administrator_approval_required',
       'prohibited_automatic_execution'
     ) then
    return true;
  end if;

  if (parsed_definition ->> 'version')::numeric % 1 <> 0
     or (parsed_definition ->> 'version')::numeric <= 0
     or (parsed_definition #>> '{retryPolicy,maxAttempts}')::numeric % 1 <> 0
     or (parsed_definition #>> '{retryPolicy,maxAttempts}')::numeric
       not between 1 and 10
     or (parsed_definition #>> '{retryPolicy,backoffMs}')::numeric % 1 <> 0
     or (parsed_definition #>> '{retryPolicy,backoffMs}')::numeric < 0
     or (parsed_definition ->> 'timeoutMs')::numeric % 1 <> 0
     or (parsed_definition ->> 'timeoutMs')::numeric < 1000 then
    return true;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(
      coalesce(parsed_definition -> 'conditions', '[]'::jsonb)
    ) condition
    where jsonb_typeof(condition) is distinct from 'string'
  ) then
    return true;
  end if;

  for parsed_action in
    select action
    from jsonb_array_elements(parsed_definition -> 'actions') action
  loop
    if jsonb_typeof(parsed_action) is distinct from 'object'
       or coalesce(parsed_action ->> 'type', '') not in (
         'create_task',
         'update_contact',
         'add_tag',
         'create_activity',
         'send_mock_email',
         'send_mock_sms',
         'send_mock_whatsapp',
         'call_webhook',
         'wait_for_duration',
         'request_approval',
         'mock_search_contact',
         'mock_create_task'
       )
       or (
         parsed_action ? 'input'
         and jsonb_typeof(parsed_action -> 'input') is distinct from 'object'
       )
       or (
         parsed_action ? 'idempotencyKey'
         and jsonb_typeof(parsed_action -> 'idempotencyKey')
           is distinct from 'string'
       ) then
      return true;
    end if;
  end loop;

  if coalesce(parsed_definition ->> 'key', '') like 'conversation_plan:%'
     or parsed_definition ->> 'trigger' = 'conversation.plan.execute' then
    return true;
  end if;

  return exists (
    select 1
    from jsonb_array_elements(parsed_definition -> 'actions') action
    where action ->> 'type' in (
      'mock_search_contact',
      'mock_create_task'
    )
  );
end;
$$;

create or replace function app_is_conversation_policy_workflow_run(
  target_tenant_id text,
  target_run_id text
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from workflow_runs run
    where run.tenant_id = target_tenant_id
      and run.id = target_run_id
      and app_is_conversation_policy_workflow(
        run.workflow_key,
        run.trigger_name,
        run.definition_snapshot
      )
  )
$$;

create or replace function app_is_conversation_policy_event(
  target_tenant_id text,
  target_event_type text,
  target_payload text
)
returns boolean
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare
  parsed_payload jsonb;
  target_run_id text;
begin
  if target_event_type = 'conversation.plan.execute' then
    return true;
  end if;

  begin
    parsed_payload := target_payload::jsonb;
  exception when others then
    return target_event_type = 'workflow.resume';
  end;

  target_run_id := nullif(parsed_payload ->> 'runId', '');
  if target_event_type = 'workflow.resume' and target_run_id is null then
    return true;
  end if;

  if target_event_type = 'workflow.resume' and not exists (
    select 1
    from workflow_runs run
    where run.tenant_id = target_tenant_id
      and run.id = target_run_id
  ) then
    return true;
  end if;

  return target_run_id is not null
    and app_is_conversation_policy_workflow_run(
      target_tenant_id,
      target_run_id
    );
end;
$$;

drop policy if exists workflow_runs_conversation_write_insert
  on workflow_runs;
create policy workflow_runs_conversation_write_insert
  on workflow_runs as restrictive for insert to public
  with check (
    app_is_system()
    or not app_is_conversation_policy_workflow(
      workflow_key,
      trigger_name,
      definition_snapshot
    )
  );

drop policy if exists workflow_runs_conversation_write_update
  on workflow_runs;
create policy workflow_runs_conversation_write_update
  on workflow_runs as restrictive for update to public
  using (
    app_is_system()
    or not app_is_conversation_policy_workflow(
      workflow_key,
      trigger_name,
      definition_snapshot
    )
  )
  with check (
    app_is_system()
    or not app_is_conversation_policy_workflow(
      workflow_key,
      trigger_name,
      definition_snapshot
    )
  );

drop policy if exists workflow_runs_conversation_write_delete
  on workflow_runs;
create policy workflow_runs_conversation_write_delete
  on workflow_runs as restrictive for delete to public
  using (
    app_is_system()
    or not app_is_conversation_policy_workflow(
      workflow_key,
      trigger_name,
      definition_snapshot
    )
  );

drop policy if exists workflow_run_steps_conversation_write_insert
  on workflow_run_steps;
create policy workflow_run_steps_conversation_write_insert
  on workflow_run_steps as restrictive for insert to public
  with check (
    app_is_system()
    or not (
      action_name in ('mock_search_contact', 'mock_create_task')
      or app_is_conversation_policy_workflow_run(
        tenant_id,
        workflow_run_id
      )
    )
  );

drop policy if exists workflow_run_steps_conversation_write_update
  on workflow_run_steps;
create policy workflow_run_steps_conversation_write_update
  on workflow_run_steps as restrictive for update to public
  using (
    app_is_system()
    or not (
      action_name in ('mock_search_contact', 'mock_create_task')
      or app_is_conversation_policy_workflow_run(
        tenant_id,
        workflow_run_id
      )
    )
  )
  with check (
    app_is_system()
    or not (
      action_name in ('mock_search_contact', 'mock_create_task')
      or app_is_conversation_policy_workflow_run(
        tenant_id,
        workflow_run_id
      )
    )
  );

drop policy if exists workflow_run_steps_conversation_write_delete
  on workflow_run_steps;
create policy workflow_run_steps_conversation_write_delete
  on workflow_run_steps as restrictive for delete to public
  using (
    app_is_system()
    or not (
      action_name in ('mock_search_contact', 'mock_create_task')
      or app_is_conversation_policy_workflow_run(
        tenant_id,
        workflow_run_id
      )
    )
  );

drop policy if exists domain_events_conversation_write_insert
  on domain_events;
create policy domain_events_conversation_write_insert
  on domain_events as restrictive for insert to public
  with check (
    app_is_system()
    or not app_is_conversation_policy_event(
      tenant_id,
      event_type,
      payload
    )
  );

drop policy if exists domain_events_conversation_write_update
  on domain_events;
create policy domain_events_conversation_write_update
  on domain_events as restrictive for update to public
  using (
    app_is_system()
    or not app_is_conversation_policy_event(
      tenant_id,
      event_type,
      payload
    )
  )
  with check (
    app_is_system()
    or not app_is_conversation_policy_event(
      tenant_id,
      event_type,
      payload
    )
  );

drop policy if exists domain_events_conversation_write_delete
  on domain_events;
create policy domain_events_conversation_write_delete
  on domain_events as restrictive for delete to public
  using (
    app_is_system()
    or not app_is_conversation_policy_event(
      tenant_id,
      event_type,
      payload
    )
  );
drop policy if exists conversation_action_plans_conversation_write_insert
  on conversation_action_plans;
create policy conversation_action_plans_conversation_write_insert
  on conversation_action_plans as restrictive for insert to public
  with check (app_is_system());

drop policy if exists conversation_action_plans_conversation_write_update
  on conversation_action_plans;
create policy conversation_action_plans_conversation_write_update
  on conversation_action_plans as restrictive for update to public
  using (app_is_system())
  with check (app_is_system());

drop policy if exists conversation_action_plans_conversation_write_delete
  on conversation_action_plans;
create policy conversation_action_plans_conversation_write_delete
  on conversation_action_plans as restrictive for delete to public
  using (app_is_system());

drop policy if exists conversation_action_plan_steps_conversation_write_insert
  on conversation_action_plan_steps;
create policy conversation_action_plan_steps_conversation_write_insert
  on conversation_action_plan_steps as restrictive for insert to public
  with check (app_is_system());

drop policy if exists conversation_action_plan_steps_conversation_write_update
  on conversation_action_plan_steps;
create policy conversation_action_plan_steps_conversation_write_update
  on conversation_action_plan_steps as restrictive for update to public
  using (app_is_system())
  with check (app_is_system());

drop policy if exists conversation_action_plan_steps_conversation_write_delete
  on conversation_action_plan_steps;
create policy conversation_action_plan_steps_conversation_write_delete
  on conversation_action_plan_steps as restrictive for delete to public
  using (app_is_system());

drop policy if exists approvals_conversation_write_insert
  on approvals;
create policy approvals_conversation_write_insert
  on approvals as restrictive for insert to public
  with check (
    app_is_system()
    or target_type <> 'conversation_action_plan'
  );

drop policy if exists approvals_conversation_write_update
  on approvals;
create policy approvals_conversation_write_update
  on approvals as restrictive for update to public
  using (
    app_is_system()
    or target_type <> 'conversation_action_plan'
  )
  with check (
    app_is_system()
    or target_type <> 'conversation_action_plan'
  );

drop policy if exists approvals_conversation_write_delete
  on approvals;
create policy approvals_conversation_write_delete
  on approvals as restrictive for delete to public
  using (
    app_is_system()
    or target_type <> 'conversation_action_plan'
  );

create or replace function reject_conversation_action_plan_delete()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if app_is_system() or not exists (
    select 1 from tenants tenant where tenant.id = old.tenant_id
  ) then
    return old;
  end if;
  raise exception 'conversation_action_plan_delete_forbidden';
end;
$$;

drop trigger if exists conversation_action_plans_delete_guard
  on conversation_action_plans;
create trigger conversation_action_plans_delete_guard
before delete on conversation_action_plans
for each row execute function reject_conversation_action_plan_delete();
