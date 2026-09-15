alter table conversation_threads
  add column if not exists confidentiality_level text;
alter table conversation_threads
  add column if not exists visibility_scope text;

update conversation_threads
set confidentiality_level = 'internal'
where confidentiality_level is null;

update conversation_threads
set visibility_scope = 'tenant'
where visibility_scope is null;

alter table conversation_threads
  alter column confidentiality_level set default 'internal';
alter table conversation_threads
  alter column confidentiality_level set not null;
alter table conversation_threads
  alter column visibility_scope set default 'tenant';
alter table conversation_threads
  alter column visibility_scope set not null;

alter table conversation_threads
  drop constraint if exists conversation_threads_confidentiality_level_check;
alter table conversation_threads
  add constraint conversation_threads_confidentiality_level_check check (
    confidentiality_level in ('public', 'internal', 'restricted', 'secret')
  );

alter table conversation_threads
  drop constraint if exists conversation_threads_visibility_scope_check;
alter table conversation_threads
  add constraint conversation_threads_visibility_scope_check check (
    visibility_scope in ('personal', 'team', 'case', 'tenant')
  );

create index if not exists idx_conversation_threads_tenant_access
  on conversation_threads (
    tenant_id, confidentiality_level, visibility_scope, updated_at desc
  );
