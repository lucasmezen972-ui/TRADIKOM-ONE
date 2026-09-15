create table if not exists conversation_thread_access_grants (
  tenant_id text not null references tenants(id) on delete cascade,
  thread_id text not null,
  user_id text not null,
  scope text not null,
  granted_by_user_id text not null,
  granted_at text not null,
  primary key (tenant_id, thread_id, user_id),
  foreign key (tenant_id, thread_id)
    references conversation_threads(tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id)
    references memberships(tenant_id, user_id) on delete cascade,
  check (scope in ('personal', 'team', 'case')),
  check (char_length(granted_by_user_id) between 1 and 160)
);

create unique index if not exists idx_conversation_thread_access_personal
  on conversation_thread_access_grants (tenant_id, thread_id)
  where scope = 'personal';
create index if not exists idx_conversation_thread_access_tenant_user
  on conversation_thread_access_grants (tenant_id, user_id, scope, thread_id);
create index if not exists idx_conversation_thread_access_tenant_thread
  on conversation_thread_access_grants (tenant_id, thread_id, scope, user_id);

create table if not exists conversation_thread_access_operations (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  thread_id text not null,
  idempotency_key_hash text not null,
  input_fingerprint text not null,
  requested_by_user_id text not null,
  visibility_scope text not null,
  grant_count integer not null,
  configured_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key_hash),
  foreign key (tenant_id, thread_id)
    references conversation_threads(tenant_id, id) on delete cascade,
  foreign key (tenant_id, requested_by_user_id)
    references memberships(tenant_id, user_id) on delete cascade,
  check (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  check (input_fingerprint ~ '^[a-f0-9]{64}$'),
  check (visibility_scope in ('personal', 'team', 'case', 'tenant')),
  check (grant_count between 0 and 100)
);

create index if not exists idx_conversation_thread_access_operations_tenant_thread
  on conversation_thread_access_operations (tenant_id, thread_id, configured_at desc);
