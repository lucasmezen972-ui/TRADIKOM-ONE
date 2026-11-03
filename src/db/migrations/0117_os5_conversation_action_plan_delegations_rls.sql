alter table conversation_action_plan_delegations enable row level security;

drop policy if exists conversation_action_plan_delegations_select
  on conversation_action_plan_delegations;
create policy conversation_action_plan_delegations_select
  on conversation_action_plan_delegations for select
  using (
    app_is_system()
    or app_actor_can_access_conversation_plan(tenant_id, plan_id)
  );

drop policy if exists conversation_action_plan_delegations_insert
  on conversation_action_plan_delegations;
create policy conversation_action_plan_delegations_insert
  on conversation_action_plan_delegations for insert
  with check (app_is_system());

drop policy if exists conversation_action_plan_delegations_update
  on conversation_action_plan_delegations;
create policy conversation_action_plan_delegations_update
  on conversation_action_plan_delegations for update
  using (app_is_system())
  with check (app_is_system());

drop policy if exists conversation_action_plan_delegations_delete
  on conversation_action_plan_delegations;
create policy conversation_action_plan_delegations_delete
  on conversation_action_plan_delegations for delete
  using (app_is_system());
