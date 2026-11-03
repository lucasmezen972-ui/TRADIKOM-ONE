alter table conversation_file_objects enable row level security;
drop policy if exists tenant_isolation on conversation_file_objects;
drop policy if exists conversation_file_read on conversation_file_objects;
create policy conversation_file_read on conversation_file_objects for select using (app_is_system() or exists (
  select 1 from conversation_message_attachments a join conversation_messages m on m.id = a.message_id and m.tenant_id = a.tenant_id
  where a.id = conversation_file_objects.attachment_id and a.tenant_id = conversation_file_objects.tenant_id
    and app_actor_can_access_conversation_thread(m.tenant_id, m.thread_id)
));
drop policy if exists conversation_file_insert on conversation_file_objects;
create policy conversation_file_insert on conversation_file_objects for insert with check (app_is_system());
drop policy if exists conversation_native_extraction_insert on conversation_message_attachments;
create policy conversation_native_extraction_insert on conversation_message_attachments as restrictive for insert
with check (extractor_mode is distinct from 'native' or app_is_system());
drop policy if exists conversation_native_document_namespace on conversation_message_attachments;
create policy conversation_native_document_namespace on conversation_message_attachments as restrictive for insert
with check (app_is_system() or (storage_reference not like 'dbdoc:%' and id !~ '^file_[a-f0-9]{64}$'));
drop policy if exists conversation_attachment_audit_access on audit_logs;
create policy conversation_attachment_audit_access on audit_logs as restrictive for select using (
  app_is_system() or target_type <> 'conversation_message_attachment' or exists (
    select 1 from conversation_message_attachments a join conversation_messages m on m.id = a.message_id and m.tenant_id = a.tenant_id
    where a.id = audit_logs.target_id and a.tenant_id = audit_logs.tenant_id
      and app_actor_can_access_conversation_thread(m.tenant_id, m.thread_id)
  )
);
