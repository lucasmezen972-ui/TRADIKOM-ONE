create table if not exists conversation_model_budget_charges (
  id text primary key,
  tenant_id text not null,
  reserved_cost_micro_usd integer not null check (reserved_cost_micro_usd = 25000),
  created_at text not null
);
create index if not exists idx_conversation_model_charges_tenant on conversation_model_budget_charges(tenant_id);

create table if not exists conversation_model_requests (
  id text primary key references conversation_model_budget_charges(id) on delete restrict,
  tenant_id text not null references tenants(id) on delete cascade,
  actor_id text not null references users(id) on delete cascade,
  thread_id text not null,
  source_message_id text not null,
  request_key_hash text not null check (request_key_hash ~ '^[a-f0-9]{64}$'),
  context_fingerprint text not null check (context_fingerprint ~ '^[a-f0-9]{64}$'),
  model text not null check (model = 'gpt-5.4-mini-2026-03-17'),
  external_context_approved boolean not null,
  consented_at text not null,
  expires_at text not null,
  status text not null check (status in ('reserved', 'succeeded', 'failed')),
  outcome_reason text check (outcome_reason in ('valid_draft', 'invalid_output', 'provider_failure')),
  input_tokens integer check (input_tokens between 0 and 1000000),
  output_tokens integer check (output_tokens between 0 and 1000000),
  completed_at text,
  generation_snapshot text check (generation_snapshot is null or char_length(generation_snapshot) <= 128000),
  unique (tenant_id, actor_id, request_key_hash),
  foreign key (tenant_id, thread_id) references conversation_threads(tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_message_id) references conversation_messages(tenant_id, id) on delete cascade,
  check ((status = 'reserved' and completed_at is null and outcome_reason is null and generation_snapshot is null)
    or (status in ('succeeded', 'failed') and completed_at is not null and outcome_reason is not null)),
  check (generation_snapshot is null or status = 'succeeded')
);

create or replace function protect_conversation_model_charge()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'conversation_model_charge_immutable';
end;
$$;
drop trigger if exists conversation_model_charge_immutable on conversation_model_budget_charges;
create trigger conversation_model_charge_immutable before update or delete on conversation_model_budget_charges
  for each row execute function protect_conversation_model_charge();

create or replace function protect_conversation_model_request()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'reserved' or new.generation_snapshot is not null
      or not exists (select 1 from conversation_messages message
        where message.tenant_id = new.tenant_id and message.thread_id = new.thread_id
          and message.id = new.source_message_id and message.direction = 'inbound' and message.kind = 'text') then
      raise exception 'conversation_model_source_invalid';
    end if;
  else
    if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
      or new.actor_id is distinct from old.actor_id or new.thread_id is distinct from old.thread_id
      or new.source_message_id is distinct from old.source_message_id
      or new.request_key_hash is distinct from old.request_key_hash
      or new.context_fingerprint is distinct from old.context_fingerprint
      or new.model is distinct from old.model
      or new.external_context_approved is distinct from old.external_context_approved
      or new.consented_at is distinct from old.consented_at or new.expires_at is distinct from old.expires_at then
      raise exception 'conversation_model_identity_immutable';
    end if;
    if old.status = 'reserved' then
      if new.status not in ('succeeded', 'failed') or new.generation_snapshot is not null then
        raise exception 'conversation_model_outcome_invalid';
      end if;
    elsif old.status <> 'succeeded' or old.generation_snapshot is not null or new.generation_snapshot is null
      or new.status is distinct from old.status or new.outcome_reason is distinct from old.outcome_reason
      or new.input_tokens is distinct from old.input_tokens or new.output_tokens is distinct from old.output_tokens
      or new.completed_at is distinct from old.completed_at then
      raise exception 'conversation_model_outcome_immutable';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists conversation_model_request_integrity on conversation_model_requests;
create trigger conversation_model_request_integrity before insert or update on conversation_model_requests
  for each row execute function protect_conversation_model_request();
