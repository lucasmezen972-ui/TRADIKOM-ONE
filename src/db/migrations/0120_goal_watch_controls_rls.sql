alter table goal_watch_controls enable row level security;
drop policy if exists tenant_isolation on goal_watch_controls;

drop policy if exists goal_watch_controls_read on goal_watch_controls;
create policy goal_watch_controls_read on goal_watch_controls for select
using (app_is_system() or app_actor_can_access_conversation_thread(tenant_id, thread_id));

drop policy if exists goal_watch_controls_insert on goal_watch_controls;
create policy goal_watch_controls_insert on goal_watch_controls for insert
with check (
  tenant_id = app_current_tenant_id()
  and consented_by = nullif(current_setting('app.actor_id', true), '')
  and updated_by = consented_by
  and app_actor_can_access_conversation_thread(tenant_id, thread_id)
  and exists (select 1 from memberships membership join users actor on actor.id = membership.user_id
    where membership.tenant_id = goal_watch_controls.tenant_id
      and membership.user_id = goal_watch_controls.consented_by and actor.deleted_at is null
      and membership.role in ('owner', 'administrator', 'manager', 'collaborator'))
);

drop policy if exists goal_watch_controls_update on goal_watch_controls;
create policy goal_watch_controls_update on goal_watch_controls for update
using (app_is_system() or app_actor_can_access_conversation_thread(tenant_id, thread_id))
with check (app_is_system() or (
  tenant_id = app_current_tenant_id()
  and updated_by = nullif(current_setting('app.actor_id', true), '')
  and app_actor_can_access_conversation_thread(tenant_id, thread_id)
  and exists (select 1 from memberships membership join users actor on actor.id = membership.user_id
    where membership.tenant_id = goal_watch_controls.tenant_id
      and membership.user_id = goal_watch_controls.updated_by and actor.deleted_at is null
      and membership.role in ('owner', 'administrator', 'manager', 'collaborator'))
));

create or replace function enforce_goal_watch_runtime_writer()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not app_is_system() and new.state is not distinct from old.state then
    raise exception 'goal_watch_schedule_system_only';
  end if;
  return new;
end;
$$;

drop trigger if exists goal_watch_runtime_writer on goal_watch_controls;
create trigger goal_watch_runtime_writer before update on goal_watch_controls
  for each row execute function enforce_goal_watch_runtime_writer();

drop policy if exists goal_watch_entry_access on business_brain_entries;
create policy goal_watch_entry_access on business_brain_entries as restrictive for all
using (app_is_system() or source_ref is distinct from 'goal-watch:v1'
  or domain <> 'objectives'
  or app_actor_can_access_conversation_thread(tenant_id, app_goal_watch_thread_id(details)))
with check (app_is_system() or source_ref is distinct from 'goal-watch:v1'
  or domain <> 'objectives'
  or app_actor_can_access_conversation_thread(tenant_id, app_goal_watch_thread_id(details)));

drop policy if exists goal_watch_evidence_access on business_brain_evidence;
create policy goal_watch_evidence_access on business_brain_evidence as restrictive for all
using (app_is_system() or exists (select 1 from business_brain_entries entry
  where entry.tenant_id = business_brain_evidence.tenant_id and entry.id = business_brain_evidence.entry_id))
with check (app_is_system() or exists (select 1 from business_brain_entries entry
  where entry.tenant_id = business_brain_evidence.tenant_id and entry.id = business_brain_evidence.entry_id));

drop policy if exists goal_watch_audit_access on audit_logs;
create policy goal_watch_audit_access on audit_logs as restrictive for select
using (app_is_system() or target_type <> 'goal_watch' or exists (
  select 1 from business_brain_entries entry where entry.tenant_id = audit_logs.tenant_id
    and entry.entry_key = audit_logs.target_id and entry.domain = 'objectives' and entry.source_ref = 'goal-watch:v1'
));

DO $$
DECLARE protected_table text; predicate text; operation text; policy_name text;
BEGIN
  FOR protected_table, predicate IN SELECT * FROM (VALUES
    ('conversation_participants', 'id !~ ''^(participant_goal_watch_[a-f0-9]{32}$|participant_native_task_)'''),
    ('conversation_channel_identities', 'id !~ ''^(identity_goal_watch_[a-f0-9]{32}$|identity_native_task_)'' and participant_id !~ ''^(participant_goal_watch_[a-f0-9]{32}$|participant_native_task_)'' and adapter_key not in (''goal-watch'', ''native-actions'')'),
    ('conversation_messages', 'adapter_key not in (''goal-watch'', ''native-actions'') and idempotency_key !~ ''^(goal-watch:report:|native-task:report:)'' and channel_identity_id !~ ''^(identity_goal_watch_[a-f0-9]{32}$|identity_native_task_)''')
  ) AS protected(table_name, access_predicate)
  LOOP
    FOREACH operation IN ARRAY ARRAY['insert', 'update', 'delete'] LOOP
      policy_name := 'trusted_conversation_proof_' || operation;
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, protected_table);
      IF operation = 'insert' THEN
        EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (app_is_system() OR (%s))', policy_name, protected_table, predicate);
      ELSIF operation = 'update' THEN
        EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE USING (app_is_system() OR (%s)) WITH CHECK (app_is_system() OR (%s))', policy_name, protected_table, predicate, predicate);
      ELSE
        EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE USING (app_is_system() OR (%s))', policy_name, protected_table, predicate);
      END IF;
    END LOOP;
  END LOOP;
END
$$;
