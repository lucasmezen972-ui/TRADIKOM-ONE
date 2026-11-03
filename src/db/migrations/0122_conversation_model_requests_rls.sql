alter table conversation_model_requests enable row level security;
alter table conversation_model_budget_charges enable row level security;
drop policy if exists tenant_isolation on conversation_model_requests;
drop policy if exists tenant_isolation on conversation_model_budget_charges;

drop policy if exists conversation_model_requests_read on conversation_model_requests;
create policy conversation_model_requests_read on conversation_model_requests for select
using (app_is_system() or app_actor_can_access_conversation_thread(tenant_id, thread_id));
drop policy if exists conversation_model_requests_insert on conversation_model_requests;
create policy conversation_model_requests_insert on conversation_model_requests for insert with check (app_is_system());
drop policy if exists conversation_model_requests_update on conversation_model_requests;
create policy conversation_model_requests_update on conversation_model_requests for update
using (app_is_system()) with check (app_is_system());

drop policy if exists conversation_model_charges_read on conversation_model_budget_charges;
create policy conversation_model_charges_read on conversation_model_budget_charges for select using (app_is_system());
drop policy if exists conversation_model_charges_insert on conversation_model_budget_charges;
create policy conversation_model_charges_insert on conversation_model_budget_charges for insert with check (app_is_system());

drop policy if exists conversation_model_audit_access on audit_logs;
create policy conversation_model_audit_access on audit_logs as restrictive for select
using (app_is_system() or target_type <> 'conversation_model_request' or exists (
  select 1 from conversation_model_requests request where request.tenant_id = audit_logs.tenant_id
    and request.id = audit_logs.target_id
));
