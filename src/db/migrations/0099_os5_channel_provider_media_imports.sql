create table if not exists channel_provider_media_imports (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  provider text not null,
  endpoint_id text not null,
  message_id text not null,
  media_kind text not null,
  reservation_status text not null,
  encrypted_provider_reference text,
  key_version text,
  request_fingerprint text not null,
  safe_error_code text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, provider, message_id),
  foreign key (tenant_id, endpoint_id, provider)
    references channel_provider_endpoints (tenant_id, id, provider)
    on delete restrict,
  foreign key (tenant_id, message_id)
    references conversation_messages (tenant_id, id)
    on delete restrict,
  check (char_length(id) between 1 and 160),
  check (provider = 'whatsapp_meta'),
  check (char_length(endpoint_id) between 1 and 160),
  check (char_length(message_id) between 1 and 160),
  check (media_kind in ('image', 'audio', 'document', 'video', 'sticker')),
  check (reservation_status in ('not_configured', 'pending', 'failed')),
  check (
    encrypted_provider_reference is null
    or char_length(encrypted_provider_reference) between 64 and 16384
  ),
  check (
    key_version is null
    or (
      char_length(key_version) between 1 and 80
      and key_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  check (
    (reservation_status = 'pending'
      and encrypted_provider_reference is not null
      and key_version is not null
      and safe_error_code is null)
    or (reservation_status = 'not_configured'
      and encrypted_provider_reference is null
      and key_version is null
      and safe_error_code = 'media_reference_vault_not_configured')
    or (reservation_status = 'failed'
      and encrypted_provider_reference is null
      and key_version is null
      and safe_error_code = 'media_reference_encryption_failed')
  ),
  check (updated_at >= created_at)
);

create or replace function reject_channel_provider_media_import_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'channel_provider_media_import_immutable';
end;
$$;

drop trigger if exists channel_provider_media_imports_immutable
  on channel_provider_media_imports;
create trigger channel_provider_media_imports_immutable
before update on channel_provider_media_imports
for each row execute function reject_channel_provider_media_import_update();

create index if not exists idx_channel_provider_media_imports_tenant_status
  on channel_provider_media_imports (
    tenant_id, provider, reservation_status, created_at, id
  );
