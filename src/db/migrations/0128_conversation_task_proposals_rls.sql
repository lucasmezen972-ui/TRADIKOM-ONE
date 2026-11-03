alter table conversation_task_proposals enable row level security;
drop policy if exists tenant_isolation on conversation_task_proposals;
drop policy if exists conversation_task_proposal_read on conversation_task_proposals;
create policy conversation_task_proposal_read on conversation_task_proposals for select
  using (app_is_system() or app_actor_can_access_conversation_thread(tenant_id, thread_id));
drop policy if exists conversation_task_proposal_insert on conversation_task_proposals;
create policy conversation_task_proposal_insert on conversation_task_proposals for insert
  with check (app_is_system());
drop policy if exists conversation_task_proposal_update on conversation_task_proposals;
create policy conversation_task_proposal_update on conversation_task_proposals for update
  using (app_is_system()) with check (app_is_system());
drop policy if exists conversation_task_proposal_audit_access on audit_logs;
create policy conversation_task_proposal_audit_access on audit_logs as restrictive for select
  using (app_is_system() or target_type <> 'conversation_task_proposal' or exists (
    select 1 from conversation_task_proposals p where p.tenant_id = audit_logs.tenant_id
      and p.id = audit_logs.target_id
  ));
