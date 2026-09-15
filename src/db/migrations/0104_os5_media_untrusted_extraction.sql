alter table channel_provider_media_import_executions
  add column if not exists extractor_mode text;

update channel_provider_media_import_executions
set extractor_mode = 'not_configured'
where extractor_mode is null;

alter table channel_provider_media_import_executions
  alter column extractor_mode set not null;

alter table channel_provider_media_import_executions
  drop constraint if exists channel_provider_media_import_executions_extractor_mode_check;
alter table channel_provider_media_import_executions
  add constraint channel_provider_media_import_executions_extractor_mode_check check (
    extractor_mode in ('mock', 'disabled', 'not_configured')
  );

alter table conversation_message_attachments
  add column if not exists trust_boundary text;
alter table conversation_message_attachments
  add column if not exists extractor_mode text;
alter table conversation_message_attachments
  add column if not exists extractor_key text;
alter table conversation_message_attachments
  add column if not exists extracted_text text;
alter table conversation_message_attachments
  add column if not exists extracted_text_sha256 text;
alter table conversation_message_attachments
  add column if not exists extracted_at text;

alter table conversation_message_attachments
  drop constraint if exists conversation_message_attachments_external_extraction_check;
alter table conversation_message_attachments
  add constraint conversation_message_attachments_external_extraction_check check (
    (
      trust_boundary is null
      and extractor_mode is null
      and extractor_key is null
      and extracted_text is null
      and extracted_text_sha256 is null
      and extracted_at is null
    )
    or (
      trust_boundary = 'external_untrusted_data'
      and extractor_mode = 'mock'
      and char_length(extractor_key) between 1 and 160
      and char_length(extracted_text) between 1 and 16000
      and extracted_text_sha256 ~ '^[A-Fa-f0-9]{64}$'
      and char_length(extracted_at) between 20 and 40
    )
  );

create or replace function protect_conversation_attachment_external_extraction()
returns trigger
language plpgsql
as $$
begin
  if new.trust_boundary is distinct from old.trust_boundary
     or new.extractor_mode is distinct from old.extractor_mode
     or new.extractor_key is distinct from old.extractor_key
     or new.extracted_text is distinct from old.extracted_text
     or new.extracted_text_sha256 is distinct from old.extracted_text_sha256
     or new.extracted_at is distinct from old.extracted_at then
    raise exception 'conversation_attachment_external_extraction_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists conversation_message_attachments_protect_external_extraction
  on conversation_message_attachments;
create trigger conversation_message_attachments_protect_external_extraction
before update on conversation_message_attachments
for each row execute function protect_conversation_attachment_external_extraction();

create or replace function protect_channel_provider_media_import_execution_identity()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id <> old.tenant_id
     or new.media_import_id <> old.media_import_id
     or new.provider <> old.provider
     or new.provider_mode <> old.provider_mode
     or new.scanner_mode <> old.scanner_mode
     or new.extractor_mode <> old.extractor_mode
     or new.storage_mode <> old.storage_mode
     or new.max_attempts <> old.max_attempts
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'channel_provider_media_import_execution_identity_immutable';
  end if;
  return new;
end;
$$;

create or replace function enforce_channel_provider_media_import_external_extraction()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'succeeded'
     and (tg_op = 'INSERT' or old.status <> 'succeeded') then
    if new.extractor_mode <> 'mock' then
      raise exception 'channel_provider_media_import_extractor_required';
    end if;
    if new.attachment_id is null or not exists (
      select 1
      from conversation_message_attachments attachment
      where attachment.tenant_id = new.tenant_id
        and attachment.id = new.attachment_id
        and attachment.trust_boundary = 'external_untrusted_data'
        and attachment.extractor_mode = 'mock'
        and attachment.extractor_key is not null
        and attachment.extracted_text is not null
        and attachment.extracted_text_sha256 is not null
    ) then
      raise exception 'channel_provider_media_import_external_extraction_required';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists channel_provider_media_import_executions_enforce_external_extraction
  on channel_provider_media_import_executions;
create trigger channel_provider_media_import_executions_enforce_external_extraction
before insert or update on channel_provider_media_import_executions
for each row execute function enforce_channel_provider_media_import_external_extraction();
