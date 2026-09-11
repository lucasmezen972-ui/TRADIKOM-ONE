create or replace function app_actor_can_access_conversation_thread(
  target_tenant_id text,
  target_thread_id text,
  target_visibility_scope text
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select
    target_tenant_id = app_current_tenant_id()
    and exists (
      select 1
      from memberships actor_membership
      where actor_membership.tenant_id = target_tenant_id
        and actor_membership.user_id = nullif(
          current_setting('app.actor_id', true),
          ''
        )
    )
    and (
      target_visibility_scope = 'tenant'
      or exists (
        select 1
        from conversation_thread_access_grants access_grant
        where access_grant.tenant_id = target_tenant_id
          and access_grant.thread_id = target_thread_id
          and access_grant.user_id = nullif(
            current_setting('app.actor_id', true),
            ''
          )
          and access_grant.scope = target_visibility_scope
      )
    )
$$;

create or replace function app_actor_can_access_conversation_thread(
  target_tenant_id text,
  target_thread_id text
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from conversation_threads thread
    where thread.tenant_id = target_tenant_id
      and thread.id = target_thread_id
      and app_actor_can_access_conversation_thread(
        thread.tenant_id,
        thread.id,
        thread.visibility_scope
      )
  )
$$;

create or replace function app_actor_can_access_conversation_message(
  target_tenant_id text,
  target_message_id text
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from conversation_messages message
    where message.tenant_id = target_tenant_id
      and message.id = target_message_id
      and app_actor_can_access_conversation_thread(
        message.tenant_id,
        message.thread_id
      )
  )
$$;

create or replace function app_actor_can_access_conversation_plan(
  target_tenant_id text,
  target_plan_id text
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from conversation_action_plans plan
    where plan.tenant_id = target_tenant_id
      and plan.id = target_plan_id
      and app_actor_can_access_conversation_thread(
        plan.tenant_id,
        plan.thread_id
      )
  )
$$;

create or replace function app_actor_can_access_workflow_run(
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
      and (
        run.workflow_key not like 'conversation_plan:%'
        or app_actor_can_access_conversation_plan(
          run.tenant_id,
          substring(
            run.workflow_key
            from char_length('conversation_plan:') + 1
          )
        )
      )
  )
$$;

create or replace function app_actor_can_access_domain_event(
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
  target_plan_id text;
begin
  if target_tenant_id is distinct from app_current_tenant_id() then
    return false;
  end if;

  begin
    parsed_payload := target_payload::jsonb;
  exception when others then
    parsed_payload := '{}'::jsonb;
  end;

  target_run_id := nullif(parsed_payload ->> 'runId', '');
  if target_run_id is not null then
    return app_actor_can_access_workflow_run(
      target_tenant_id,
      target_run_id
    );
  end if;

  target_plan_id := nullif(parsed_payload ->> 'planId', '');
  if target_plan_id is not null then
    return app_actor_can_access_conversation_plan(
      target_tenant_id,
      target_plan_id
    );
  end if;

  return target_event_type <> 'conversation.plan.execute';
end;
$$;

do $$
declare
  target_table text;
  access_predicate text;
  policy_name text;
begin
  for target_table, access_predicate in
    select * from (values
      (
        'conversation_threads',
        'app_actor_can_access_conversation_thread(tenant_id, id, visibility_scope)'
      ),
      (
        'conversation_thread_participants',
        'app_actor_can_access_conversation_thread(tenant_id, thread_id)'
      ),
      (
        'conversation_messages',
        'app_actor_can_access_conversation_thread(tenant_id, thread_id)'
      ),
      (
        'conversation_message_attachments',
        'app_actor_can_access_conversation_message(tenant_id, message_id)'
      ),
      (
        'conversation_message_route_hops',
        'app_actor_can_access_conversation_message(tenant_id, message_id)'
      ),
      (
        'conversation_action_plans',
        'app_actor_can_access_conversation_thread(tenant_id, thread_id)'
      ),
      (
        'conversation_action_plan_steps',
        'app_actor_can_access_conversation_plan(tenant_id, plan_id)'
      ),
      (
        'workflow_runs',
        $predicate$tenant_id = app_current_tenant_id()
          and (
            workflow_key not like 'conversation_plan:%'
            or app_actor_can_access_conversation_plan(
              tenant_id,
              substring(
                workflow_key
                from char_length('conversation_plan:') + 1
              )
            )
          )$predicate$
      ),
      (
        'workflow_run_steps',
        'app_actor_can_access_workflow_run(tenant_id, workflow_run_id)'
      ),
      (
        'approvals',
        $predicate$tenant_id = app_current_tenant_id()
          and (
            target_type <> 'conversation_action_plan'
            or app_actor_can_access_conversation_plan(tenant_id, target_id)
          )$predicate$
      ),
      (
        'domain_events',
        'app_actor_can_access_domain_event(tenant_id, event_type, payload)'
      )
    ) as policy_targets(table_name, predicate)
  loop
    execute format(
      'drop policy if exists %I on %I',
      'tenant_isolation',
      target_table
    );
    execute format(
      'drop policy if exists %I on %I',
      'tenant_' || target_table,
      target_table
    );

    foreach policy_name in array array[
      target_table || '_actor_select',
      target_table || '_actor_insert',
      target_table || '_actor_update',
      target_table || '_actor_delete'
    ]
    loop
      execute format(
        'drop policy if exists %I on %I',
        policy_name,
        target_table
      );
    end loop;

    execute format(
      'create policy %I on %I for select to public using (app_is_system() or (%s))',
      target_table || '_actor_select',
      target_table,
      access_predicate
    );
    execute format(
      'create policy %I on %I for insert to public with check (app_is_system() or (%s))',
      target_table || '_actor_insert',
      target_table,
      access_predicate
    );
    execute format(
      'create policy %I on %I for update to public using (app_is_system() or (%s)) with check (app_is_system() or (%s))',
      target_table || '_actor_update',
      target_table,
      access_predicate,
      access_predicate
    );
    execute format(
      'create policy %I on %I for delete to public using (app_is_system() or (%s))',
      target_table || '_actor_delete',
      target_table,
      access_predicate
    );
  end loop;
end;
$$;
