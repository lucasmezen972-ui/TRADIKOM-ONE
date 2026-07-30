alter table conversation_action_plans enable row level security;
alter table conversation_action_plan_steps enable row level security;

drop policy if exists tenant_isolation on conversation_action_plans;
create policy tenant_isolation on conversation_action_plans
  for all
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on conversation_action_plan_steps;
create policy tenant_isolation on conversation_action_plan_steps
  for all
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
