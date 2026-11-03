create unique index if not exists idx_contacts_task_proposal_identity on contacts(tenant_id, id);
create unique index if not exists idx_tasks_task_proposal_identity on tasks(tenant_id, id);

create table if not exists conversation_task_proposals (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  actor_id text not null references users(id) on delete cascade,
  thread_id text not null,
  source_message_id text not null,
  source_fingerprint text not null check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  request_key_hash text not null check (request_key_hash ~ '^[a-f0-9]{64}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  contact_id text not null,
  title text not null check (char_length(title) between 3 and 200),
  due_at text not null,
  status text not null check (status in ('pending', 'executed', 'rejected')),
  task_id text,
  report_message_id text,
  created_at text not null,
  decided_at text,
  unique (tenant_id, actor_id, request_key_hash),
  foreign key (tenant_id, thread_id) references conversation_threads(tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_message_id) references conversation_messages(tenant_id, id) on delete cascade,
  foreign key (tenant_id, report_message_id) references conversation_messages(tenant_id, id),
  foreign key (tenant_id, contact_id) references contacts(tenant_id, id) on delete cascade,
  foreign key (tenant_id, task_id) references tasks(tenant_id, id),
  check ((status = 'pending' and decided_at is null and task_id is null and report_message_id is null)
    or (status = 'rejected' and decided_at is not null and task_id is null and report_message_id is null)
    or (status = 'executed' and decided_at is not null and task_id is not null and report_message_id is not null))
);
create index if not exists idx_conversation_task_proposals_tenant_thread
  on conversation_task_proposals(tenant_id, thread_id, created_at desc, id);

create or replace function protect_conversation_task_proposal() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or not exists (select 1 from conversation_messages m
      where m.tenant_id = new.tenant_id and m.thread_id = new.thread_id
        and m.id = new.source_message_id and m.direction = 'inbound' and m.kind = 'text') then
      raise exception 'conversation_task_proposal_source_invalid';
    end if;
  else
    if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
      or new.actor_id is distinct from old.actor_id or new.thread_id is distinct from old.thread_id
      or new.source_message_id is distinct from old.source_message_id
      or new.source_fingerprint is distinct from old.source_fingerprint
      or new.request_key_hash is distinct from old.request_key_hash
      or new.request_fingerprint is distinct from old.request_fingerprint
      or new.contact_id is distinct from old.contact_id or new.title is distinct from old.title
      or new.due_at is distinct from old.due_at or new.created_at is distinct from old.created_at then
      raise exception 'conversation_task_proposal_immutable';
    end if;
    if old.status <> 'pending' or new.status not in ('executed', 'rejected') then
      raise exception 'conversation_task_proposal_terminal';
    end if;
    if new.status = 'executed' and (
      not exists (select 1 from tasks t where t.tenant_id = new.tenant_id and t.id = new.task_id
        and t.related_type = 'contact' and t.related_id = new.contact_id and t.title = new.title
        and t.due_at = new.due_at and t.assigned_user_id = new.actor_id)
      or not exists (select 1 from conversation_messages m where m.tenant_id = new.tenant_id
        and m.thread_id = new.thread_id and m.id = new.report_message_id
        and m.adapter_key = 'native-actions' and m.causation_id = new.source_message_id)
    ) then raise exception 'conversation_task_proposal_evidence_invalid'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists conversation_task_proposal_integrity on conversation_task_proposals;
create trigger conversation_task_proposal_integrity before insert or update on conversation_task_proposals
  for each row execute function protect_conversation_task_proposal();
