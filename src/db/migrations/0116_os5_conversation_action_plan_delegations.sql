create unique index if not exists uq_conversation_action_plan_delegation_reference
  on conversation_action_plans (tenant_id, id, plan_fingerprint);

create unique index if not exists uq_approvals_conversation_delegation_reference
  on approvals (tenant_id, id, target_type, target_id);

create table if not exists conversation_action_plan_delegations (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  plan_id text not null,
  plan_fingerprint text not null,
  approval_id text not null,
  approval_target_type text not null default 'conversation_action_plan',
  version integer not null,
  expected_previous_version integer not null,
  delegated_by_user_id text not null references users(id) on delete restrict,
  delegated_to_user_id text not null references users(id) on delete restrict,
  delegated_to_role text not null,
  idempotency_key_hash text not null,
  request_fingerprint text not null,
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, plan_id, version),
  unique (tenant_id, idempotency_key_hash),
  foreign key (tenant_id, plan_id, plan_fingerprint)
    references conversation_action_plans(tenant_id, id, plan_fingerprint)
    on delete cascade,
  foreign key (
    tenant_id, approval_id, approval_target_type, plan_id
  ) references approvals(tenant_id, id, target_type, target_id)
    on delete cascade,
  check (char_length(id) between 1 and 160),
  check (plan_fingerprint ~ '^[A-Fa-f0-9]{64}$'),
  check (approval_target_type = 'conversation_action_plan'),
  check (version between 1 and 32),
  check (expected_previous_version between 0 and 31),
  check (expected_previous_version = version - 1),
  check (delegated_to_role in ('owner', 'administrator', 'manager')),
  check (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  check (char_length(created_at) between 1 and 64)
);

comment on table conversation_action_plan_delegations is
  'Historique immuable et versionné de la responsabilité de décision pour une version exacte de plan Conversation.';
comment on column conversation_action_plan_delegations.idempotency_key_hash is
  'Empreinte SHA-256 de la clé de rejeu. La clé brute ne doit jamais être persistée.';

create index if not exists idx_conversation_action_plan_delegations_latest
  on conversation_action_plan_delegations (
    tenant_id, plan_id, version desc
  );
create index if not exists idx_conversation_action_plan_delegations_target
  on conversation_action_plan_delegations (
    tenant_id, delegated_to_user_id, created_at desc
  );

create or replace function enforce_conversation_action_plan_delegation_binding()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  target_plan conversation_action_plans%rowtype;
  current_delegation conversation_action_plan_delegations%rowtype;
  actor_role text;
  target_role text;
begin
  select * into target_plan
  from conversation_action_plans
  where tenant_id = new.tenant_id
    and id = new.plan_id
    and plan_fingerprint = new.plan_fingerprint
  for update;

  if not found
    or target_plan.approval_status is distinct from 'awaiting_approval'
    or target_plan.decided_by is not null
    or target_plan.decided_at is not null
    or target_plan.decision_reason is not null
    or exists (
      select 1 from conversation_action_plans successor
      where successor.tenant_id = target_plan.tenant_id
        and successor.supersedes_plan_id = target_plan.id
    )
    or exists (
      select 1 from conversation_action_plan_policy_receipts receipt
      where receipt.tenant_id = target_plan.tenant_id
        and receipt.plan_id = target_plan.id
    )
    or exists (
      select 1 from workflow_runs run
      where run.tenant_id = target_plan.tenant_id
        and run.workflow_key = 'conversation_plan:' || target_plan.id
    )
    or not exists (
      select 1 from approvals approval
      where approval.tenant_id = target_plan.tenant_id
        and approval.id = new.approval_id
        and approval.target_type = 'conversation_action_plan'
        and approval.target_id = target_plan.id
        and approval.status = 'pending'
    ) then
    raise exception 'conversation_action_plan_delegation_plan_invalid';
  end if;

  select membership.role into actor_role
  from memberships membership
  join users actor on actor.id = membership.user_id
  where membership.tenant_id = new.tenant_id
    and membership.user_id = new.delegated_by_user_id
    and actor.deleted_at is null;

  select membership.role into target_role
  from memberships membership
  join users target on target.id = membership.user_id
  where membership.tenant_id = new.tenant_id
    and membership.user_id = new.delegated_to_user_id
    and target.deleted_at is null;

  if actor_role is null
    or target_role is null
    or actor_role not in ('owner', 'administrator', 'manager')
    or target_role not in ('owner', 'administrator', 'manager')
    or new.delegated_to_role is distinct from target_role then
    raise exception 'conversation_action_plan_delegation_role_invalid';
  end if;

  if not exists (
    select 1
    from conversation_threads thread
    where thread.tenant_id = target_plan.tenant_id
      and thread.id = target_plan.thread_id
      and (
        thread.visibility_scope = 'tenant'
        or exists (
          select 1 from conversation_thread_access_grants access_grant
          where access_grant.tenant_id = thread.tenant_id
            and access_grant.thread_id = thread.id
            and access_grant.user_id = new.delegated_by_user_id
            and access_grant.scope = thread.visibility_scope
        )
      )
  ) or not exists (
    select 1
    from conversation_threads thread
    where thread.tenant_id = target_plan.tenant_id
      and thread.id = target_plan.thread_id
      and (
        thread.visibility_scope = 'tenant'
        or exists (
          select 1 from conversation_thread_access_grants access_grant
          where access_grant.tenant_id = thread.tenant_id
            and access_grant.thread_id = thread.id
            and access_grant.user_id = new.delegated_to_user_id
            and access_grant.scope = thread.visibility_scope
        )
      )
  ) then
    raise exception 'conversation_action_plan_delegation_access_invalid';
  end if;

  select * into current_delegation
  from conversation_action_plan_delegations delegation
  where delegation.tenant_id = new.tenant_id
    and delegation.plan_id = new.plan_id
  order by delegation.version desc
  limit 1;

  if found then
    if new.expected_previous_version is distinct from current_delegation.version
      or new.version is distinct from current_delegation.version + 1
      or new.delegated_to_user_id is not distinct from
        current_delegation.delegated_to_user_id
      or (
        new.delegated_by_user_id is distinct from
          current_delegation.delegated_to_user_id
        and actor_role not in ('owner', 'administrator')
      ) then
      raise exception 'conversation_action_plan_delegation_transition_invalid';
    end if;
  elsif new.expected_previous_version <> 0
    or new.version <> 1
    or new.delegated_by_user_id is not distinct from
      new.delegated_to_user_id then
    raise exception 'conversation_action_plan_delegation_transition_invalid';
  end if;

  return new;
end;
$$;

drop trigger if exists conversation_action_plan_delegations_binding
  on conversation_action_plan_delegations;
create trigger conversation_action_plan_delegations_binding
before insert on conversation_action_plan_delegations
for each row execute function enforce_conversation_action_plan_delegation_binding();

create or replace function reject_conversation_action_plan_delegation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from tenants tenant where tenant.id = old.tenant_id
  ) then
    return old;
  end if;
  raise exception 'conversation_action_plan_delegation_immutable';
end;
$$;

drop trigger if exists conversation_action_plan_delegations_immutable
  on conversation_action_plan_delegations;
create trigger conversation_action_plan_delegations_immutable
before update or delete on conversation_action_plan_delegations
for each row execute function reject_conversation_action_plan_delegation_mutation();

create or replace function enforce_conversation_action_plan_delegated_decider()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  delegated_user_id text;
begin
  if old.approval_status = 'awaiting_approval'
    and new.approval_status in ('approved', 'rejected') then
    select delegation.delegated_to_user_id into delegated_user_id
    from conversation_action_plan_delegations delegation
    where delegation.tenant_id = old.tenant_id
      and delegation.plan_id = old.id
    order by delegation.version desc
    limit 1;

    if found and (
      new.decided_by is distinct from delegated_user_id
      or not exists (
        select 1
        from memberships membership
        join users delegated_user on delegated_user.id = membership.user_id
        where membership.tenant_id = old.tenant_id
          and membership.user_id = delegated_user_id
          and membership.role in ('owner', 'administrator', 'manager')
          and delegated_user.deleted_at is null
      )
    ) then
      raise exception 'conversation_action_plan_delegated_decider_invalid';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists conversation_action_plan_delegated_decider
  on conversation_action_plans;
create trigger conversation_action_plan_delegated_decider
before update on conversation_action_plans
for each row execute function enforce_conversation_action_plan_delegated_decider();
