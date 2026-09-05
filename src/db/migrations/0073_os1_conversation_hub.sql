create table if not exists conversation_participants (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  role text not null,
  display_name text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  check (role in ('customer', 'member', 'assistant', 'system')),
  check (display_name is null or char_length(display_name) between 1 and 160),
  check (updated_at >= created_at)
);

create table if not exists conversation_channel_identities (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  participant_id text not null,
  channel_kind text not null,
  adapter_key text not null,
  external_subject_id text not null,
  display_name text,
  role text not null,
  state text not null,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, adapter_key, external_subject_id),
  foreign key (tenant_id, participant_id)
    references conversation_participants(tenant_id, id) on delete cascade,
  check (channel_kind in (
    'web', 'messaging', 'email', 'voice', 'collaboration', 'test'
  )),
  check (char_length(adapter_key) between 1 and 160),
  check (char_length(external_subject_id) between 1 and 256),
  check (display_name is null or char_length(display_name) between 1 and 160),
  check (role in ('customer', 'member', 'assistant', 'system')),
  check (state in ('active', 'unverified', 'blocked', 'revoked')),
  check (updated_at >= created_at)
);

create table if not exists conversation_threads (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  status text not null,
  subject text,
  created_at text not null,
  updated_at text not null,
  last_message_at text,
  unique (tenant_id, id),
  check (status in ('open', 'awaiting_validation', 'resolved', 'archived')),
  check (subject is null or char_length(subject) between 1 and 200),
  check (updated_at >= created_at),
  check (last_message_at is null or last_message_at >= created_at)
);

create table if not exists conversation_thread_participants (
  tenant_id text not null references tenants(id) on delete cascade,
  thread_id text not null,
  channel_identity_id text not null,
  joined_at text not null,
  left_at text,
  primary key (tenant_id, thread_id, channel_identity_id),
  foreign key (tenant_id, thread_id)
    references conversation_threads(tenant_id, id) on delete cascade,
  foreign key (tenant_id, channel_identity_id)
    references conversation_channel_identities(tenant_id, id) on delete cascade,
  check (left_at is null or left_at >= joined_at)
);

create table if not exists conversation_messages (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  thread_id text not null,
  channel_identity_id text not null,
  direction text not null,
  kind text not null,
  status text not null,
  text_content text,
  adapter_key text not null,
  external_message_id text,
  idempotency_key text not null,
  correlation_id text not null,
  causation_id text,
  safe_error_code text,
  occurred_at text not null,
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, adapter_key, external_message_id),
  foreign key (tenant_id, thread_id)
    references conversation_threads(tenant_id, id) on delete cascade,
  foreign key (tenant_id, channel_identity_id)
    references conversation_channel_identities(tenant_id, id) on delete restrict,
  check (direction in ('inbound', 'outbound', 'internal')),
  check (kind in ('text', 'system', 'plan', 'approval', 'result')),
  check (status in ('received', 'pending', 'sent', 'delivered', 'failed')),
  check (text_content is null or char_length(text_content) between 1 and 16000),
  check (char_length(adapter_key) between 1 and 160),
  check (external_message_id is null or char_length(external_message_id) between 1 and 256),
  check (char_length(idempotency_key) between 8 and 160),
  check (char_length(correlation_id) between 8 and 160),
  check (causation_id is null or char_length(causation_id) between 1 and 160),
  check (safe_error_code is null or char_length(safe_error_code) between 1 and 160),
  check (created_at >= occurred_at)
);

create table if not exists conversation_message_attachments (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  message_id text not null,
  kind text not null,
  file_name text not null,
  media_type text not null,
  size_bytes integer not null,
  storage_reference text not null,
  checksum_sha256 text not null,
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, message_id)
    references conversation_messages(tenant_id, id) on delete cascade,
  check (kind in ('document', 'image', 'audio', 'video', 'file')),
  check (char_length(file_name) between 1 and 255),
  check (char_length(media_type) between 3 and 120),
  check (size_bytes between 1 and 26214400),
  check (char_length(storage_reference) between 1 and 512),
  check (checksum_sha256 ~ '^[A-Fa-f0-9]{64}$')
);

create table if not exists conversation_message_route_hops (
  tenant_id text not null references tenants(id) on delete cascade,
  message_id text not null,
  position integer not null,
  adapter_key text not null,
  channel_identity_id text not null,
  external_message_id text,
  primary key (tenant_id, message_id, position),
  unique (tenant_id, message_id, adapter_key, channel_identity_id),
  foreign key (tenant_id, message_id)
    references conversation_messages(tenant_id, id) on delete cascade,
  foreign key (tenant_id, channel_identity_id)
    references conversation_channel_identities(tenant_id, id) on delete restrict,
  check (position between 0 and 7),
  check (char_length(adapter_key) between 1 and 160),
  check (external_message_id is null or char_length(external_message_id) between 1 and 256)
);

create index if not exists idx_conversation_participants_tenant_role
  on conversation_participants (tenant_id, role, updated_at desc);
create index if not exists idx_conversation_channel_identities_tenant_participant
  on conversation_channel_identities (tenant_id, participant_id, updated_at desc);
create index if not exists idx_conversation_threads_tenant_status
  on conversation_threads (tenant_id, status, updated_at desc);
create index if not exists idx_conversation_thread_participants_tenant_identity
  on conversation_thread_participants (tenant_id, channel_identity_id, thread_id);
create index if not exists idx_conversation_messages_tenant_thread_time
  on conversation_messages (tenant_id, thread_id, occurred_at, id);
create index if not exists idx_conversation_messages_tenant_correlation
  on conversation_messages (tenant_id, correlation_id, occurred_at);
create index if not exists idx_conversation_message_attachments_tenant_message
  on conversation_message_attachments (tenant_id, message_id, id);
create index if not exists idx_conversation_message_route_hops_tenant_identity
  on conversation_message_route_hops (tenant_id, channel_identity_id, message_id);
