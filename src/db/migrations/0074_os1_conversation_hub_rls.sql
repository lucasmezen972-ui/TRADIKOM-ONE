alter table conversation_participants enable row level security;
alter table conversation_channel_identities enable row level security;
alter table conversation_threads enable row level security;
alter table conversation_thread_participants enable row level security;
alter table conversation_messages enable row level security;
alter table conversation_message_attachments enable row level security;
alter table conversation_message_route_hops enable row level security;

drop policy if exists tenant_isolation on conversation_participants;
create policy tenant_isolation on conversation_participants
  for all
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on conversation_channel_identities;
create policy tenant_isolation on conversation_channel_identities
  for all
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on conversation_threads;
create policy tenant_isolation on conversation_threads
  for all
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on conversation_thread_participants;
create policy tenant_isolation on conversation_thread_participants
  for all
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on conversation_messages;
create policy tenant_isolation on conversation_messages
  for all
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on conversation_message_attachments;
create policy tenant_isolation on conversation_message_attachments
  for all
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());

drop policy if exists tenant_isolation on conversation_message_route_hops;
create policy tenant_isolation on conversation_message_route_hops
  for all
  using (app_is_system() or tenant_id = app_current_tenant_id())
  with check (app_is_system() or tenant_id = app_current_tenant_id());
