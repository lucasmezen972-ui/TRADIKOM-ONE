create table if not exists conversation_file_objects (
  attachment_id text primary key references conversation_message_attachments(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  key_version text not null,
  envelope text not null check (char_length(envelope) <= 710000),
  size_bytes integer not null check (size_bytes between 1 and 524288),
  created_at text not null,
  unique (tenant_id, attachment_id)
);
alter table conversation_message_attachments drop constraint if exists conversation_message_attachments_external_extraction_check;
alter table conversation_message_attachments add constraint conversation_message_attachments_external_extraction_check check (
  (trust_boundary is null and extractor_mode is null and extractor_key is null and extracted_text is null and extracted_text_sha256 is null and extracted_at is null)
  or (trust_boundary = 'external_untrusted_data' and extractor_mode in ('mock', 'native')
    and char_length(extractor_key) between 1 and 160 and char_length(extracted_text) between 1 and 16000
    and extracted_text_sha256 ~ '^[A-Fa-f0-9]{64}$' and char_length(extracted_at) between 20 and 40
    and (extractor_mode <> 'native' or extractor_key in ('native-utf8-v1', 'native-pdf-text-v1')))
);
create or replace function enforce_conversation_native_document_identity() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then raise exception 'conversation_native_document_immutable'; end if;
  if not exists (select 1 from conversation_message_attachments a where a.id = new.attachment_id
    and a.tenant_id = new.tenant_id and a.size_bytes = new.size_bytes
    and a.storage_reference = 'dbdoc:' || new.tenant_id || ':' || new.attachment_id
    and a.extractor_mode = 'native') then raise exception 'conversation_native_document_identity_invalid'; end if;
  return new;
end;
$$;
drop trigger if exists conversation_native_document_identity on conversation_file_objects;
create trigger conversation_native_document_identity before insert or update on conversation_file_objects
for each row execute function enforce_conversation_native_document_identity();
