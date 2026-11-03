alter table conversation_action_plan_policy_receipts enable row level security;

drop policy if exists conversation_action_plan_policy_receipts_select
  on conversation_action_plan_policy_receipts;
create policy conversation_action_plan_policy_receipts_select
  on conversation_action_plan_policy_receipts for select
  using (
    app_is_system()
    or app_actor_can_access_conversation_plan(tenant_id, plan_id)
  );

drop policy if exists conversation_action_plan_policy_receipts_insert
  on conversation_action_plan_policy_receipts;
create policy conversation_action_plan_policy_receipts_insert
  on conversation_action_plan_policy_receipts for insert
  with check (app_is_system());

drop policy if exists conversation_action_plan_policy_receipts_update
  on conversation_action_plan_policy_receipts;
create policy conversation_action_plan_policy_receipts_update
  on conversation_action_plan_policy_receipts for update
  using (app_is_system())
  with check (app_is_system());

drop policy if exists conversation_action_plan_policy_receipts_delete
  on conversation_action_plan_policy_receipts;
create policy conversation_action_plan_policy_receipts_delete
  on conversation_action_plan_policy_receipts for delete
  using (app_is_system());
