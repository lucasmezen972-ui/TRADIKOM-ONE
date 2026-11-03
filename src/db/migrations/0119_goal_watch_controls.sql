create table if not exists goal_watch_controls (
  entry_id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  goal_id text not null,
  thread_id text not null,
  state text not null check (state in ('active', 'paused', 'stopped')),
  version integer not null check (version >= 1),
  consented_by text not null references users(id),
  consented_at text not null check (char_length(consented_at) between 1 and 64),
  updated_by text not null references users(id),
  updated_at text not null,
  next_due_at timestamptz not null,
  unique (tenant_id, goal_id),
  foreign key (tenant_id, entry_id) references business_brain_entries(tenant_id, id) on delete cascade,
  foreign key (tenant_id, thread_id) references conversation_threads(tenant_id, id) on delete cascade
);

create index if not exists idx_goal_watch_due
  on goal_watch_controls(next_due_at, tenant_id, goal_id) where state = 'active';

create or replace function enforce_goal_watch_control_integrity()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'active' or new.version <> 1
      or new.consented_by <> new.updated_by
      or not exists (
        select 1 from business_brain_entries entry
        where entry.tenant_id = new.tenant_id and entry.id = new.entry_id
          and entry.entry_key = new.goal_id and entry.domain = 'objectives'
          and entry.source_ref = 'goal-watch:v1' and entry.status = 'active'
          and entry.details::jsonb ->> 'threadId' = new.thread_id
      ) then
      raise exception 'goal_watch_control_binding_invalid';
    end if;
  else
    if new.entry_id is distinct from old.entry_id
      or new.tenant_id is distinct from old.tenant_id
      or new.goal_id is distinct from old.goal_id
      or new.thread_id is distinct from old.thread_id
      or old.state = 'stopped' then
      raise exception 'goal_watch_control_immutable';
    end if;
    if new.state is distinct from old.state then
      if new.version <> old.version + 1 then
        raise exception 'goal_watch_control_version_invalid';
      end if;
      if new.state = 'active' then
        if new.consented_by <> new.updated_by then
          raise exception 'goal_watch_consent_invalid';
        end if;
      elsif new.consented_by is distinct from old.consented_by
        or new.consented_at is distinct from old.consented_at then
        raise exception 'goal_watch_consent_immutable';
      end if;
    elsif new.version <> old.version
      or new.consented_by is distinct from old.consented_by
      or new.consented_at is distinct from old.consented_at
      or new.updated_by is distinct from old.updated_by
      or new.updated_at is distinct from old.updated_at then
      raise exception 'goal_watch_control_version_invalid';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists goal_watch_control_integrity on goal_watch_controls;
create trigger goal_watch_control_integrity before insert or update on goal_watch_controls
  for each row execute function enforce_goal_watch_control_integrity();

create or replace function protect_goal_watch_entry()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.domain = 'objectives' and old.source_ref = 'goal-watch:v1'
    and exists (select 1 from tenants where id = old.tenant_id) then
    raise exception 'goal_watch_entry_immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists goal_watch_entry_immutable on business_brain_entries;
create trigger goal_watch_entry_immutable before update or delete on business_brain_entries
  for each row execute function protect_goal_watch_entry();

create or replace function app_goal_watch_thread_id(details text)
returns text language plpgsql immutable security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  return details::jsonb ->> 'threadId';
exception when invalid_text_representation then return null;
end;
$$;

