alter table channel_provider_media_import_executions
  add column if not exists scanner_mode text;

update channel_provider_media_import_executions
set scanner_mode = 'not_configured'
where scanner_mode is null;

alter table channel_provider_media_import_executions
  alter column scanner_mode set not null;

alter table channel_provider_media_import_executions
  drop constraint if exists channel_provider_media_import_executions_scanner_mode_check;
alter table channel_provider_media_import_executions
  add constraint channel_provider_media_import_executions_scanner_mode_check check (
    scanner_mode in ('mock', 'disabled', 'not_configured')
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
     or new.scanner_mode <> old.scanner_mode
     or new.storage_mode <> old.storage_mode
     or new.max_attempts <> old.max_attempts
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'channel_provider_media_import_execution_identity_immutable';
  end if;
  return new;
end;
$$;

create or replace function enforce_channel_provider_media_import_scan_success()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'succeeded'
     and (tg_op = 'INSERT' or old.status <> 'succeeded')
     and new.scanner_mode <> 'mock' then
    raise exception 'channel_provider_media_import_scan_required';
  end if;
  return new;
end;
$$;

drop trigger if exists channel_provider_media_import_executions_enforce_scan
  on channel_provider_media_import_executions;
create trigger channel_provider_media_import_executions_enforce_scan
before insert or update on channel_provider_media_import_executions
for each row execute function enforce_channel_provider_media_import_scan_success();
