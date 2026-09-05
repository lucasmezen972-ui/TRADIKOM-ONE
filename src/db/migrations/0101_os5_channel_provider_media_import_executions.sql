create unique index if not exists uq_channel_provider_media_imports_tenant_id_provider
  on channel_provider_media_imports (tenant_id, id, provider);

create table if not exists channel_provider_media_import_executions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  media_import_id text not null,
  provider text not null,
  provider_mode text not null,
  storage_mode text not null,
  status text not null,
  failure_classification text,
  safe_error_code text,
  retryable boolean,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  next_attempt_at text not null,
  last_attempted_at text,
  lease_id text,
  lease_expires_at text,
  attachment_id text,
  created_by text not null references users(id) on delete restrict,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, media_import_id),
  foreign key (tenant_id, media_import_id, provider)
    references channel_provider_media_imports (tenant_id, id, provider)
    on delete restrict,
  foreign key (tenant_id, attachment_id)
    references conversation_message_attachments (tenant_id, id)
    on delete restrict,
  check (char_length(id) between 1 and 160),
  check (provider = 'whatsapp_meta'),
  check (provider_mode in ('mock', 'disabled', 'not_configured')),
  check (storage_mode in ('mock', 'disabled', 'not_configured')),
  check (status in ('reserved', 'succeeded', 'failed', 'denied')),
  check (
    failure_classification is null
    or failure_classification in (
      'temporary', 'permanent', 'validation', 'policy', 'not_configured'
    )
  ),
  check (
    safe_error_code is null
    or (
      char_length(safe_error_code) between 1 and 160
      and safe_error_code ~ '^[a-z][a-z0-9_]*$'
    )
  ),
  check (attempts between 0 and max_attempts),
  check (max_attempts between 1 and 10),
  check (next_attempt_at >= created_at),
  check (last_attempted_at is null or last_attempted_at >= created_at),
  check (
    (lease_id is null and lease_expires_at is null)
    or (
      lease_id is not null
      and char_length(lease_id) between 8 and 160
      and lease_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
      and lease_expires_at is not null
      and last_attempted_at is not null
      and lease_expires_at > last_attempted_at
      and status in ('reserved', 'failed')
      and attempts > 0
    )
  ),
  check (
    (status = 'reserved'
      and failure_classification is null
      and safe_error_code is null
      and retryable is null
      and attachment_id is null)
    or (status = 'succeeded'
      and provider_mode = 'mock'
      and storage_mode = 'mock'
      and failure_classification is null
      and safe_error_code is null
      and retryable = false
      and attachment_id is not null)
    or (status = 'failed'
      and failure_classification in ('temporary', 'permanent', 'validation')
      and safe_error_code is not null
      and retryable is not null
      and attachment_id is null)
    or (status = 'denied'
      and failure_classification in ('policy', 'not_configured')
      and safe_error_code is not null
      and retryable = false
      and attachment_id is null)
  ),
  check (
    retryable is null
    or retryable = false
    or (status = 'failed' and failure_classification = 'temporary')
  ),
  check (updated_at >= created_at)
);

create or replace function protect_channel_provider_media_import_execution_identity()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id <> old.tenant_id
     or new.media_import_id <> old.media_import_id
     or new.provider <> old.provider
     or new.provider_mode <> old.provider_mode
     or new.storage_mode <> old.storage_mode
     or new.max_attempts <> old.max_attempts
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'channel_provider_media_import_execution_identity_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists channel_provider_media_import_executions_protect_identity
  on channel_provider_media_import_executions;
create trigger channel_provider_media_import_executions_protect_identity
before update on channel_provider_media_import_executions
for each row execute function protect_channel_provider_media_import_execution_identity();

create index if not exists idx_channel_provider_media_import_executions_tenant_due
  on channel_provider_media_import_executions (
    tenant_id, provider, next_attempt_at, status, lease_expires_at
  );
