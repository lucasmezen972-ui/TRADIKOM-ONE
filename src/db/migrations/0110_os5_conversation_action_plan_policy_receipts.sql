create unique index if not exists uq_conversation_action_plans_policy_receipt_reference
  on conversation_action_plans (
    tenant_id, id, plan_fingerprint, decided_by
  );

create unique index if not exists uq_approvals_policy_receipt_reference
  on approvals (tenant_id, id, target_type, target_id, status);

create table if not exists conversation_action_plan_policy_receipts (
  id uuid primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  plan_id text not null,
  plan_fingerprint text not null,
  approval_id text,
  approval_mode text not null,
  approval_status text not null,
  approved_by_user_id text not null,
  approval_target_type text not null default 'conversation_action_plan',
  payload_json jsonb not null,
  receipt_fingerprint text not null,
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, plan_id),
  unique (tenant_id, receipt_fingerprint),
  foreign key (
    tenant_id, plan_id, plan_fingerprint, approved_by_user_id
  ) references conversation_action_plans(
    tenant_id, id, plan_fingerprint, decided_by
  )
    on delete cascade,
  foreign key (
    tenant_id, approval_id, approval_target_type, plan_id, approval_status
  ) references approvals(tenant_id, id, target_type, target_id, status)
    on delete cascade,
  check (plan_fingerprint ~ '^[A-Fa-f0-9]{64}$'),
  check (receipt_fingerprint ~ '^[a-f0-9]{64}$'),
  check (char_length(approved_by_user_id) between 1 and 160),
  check (approval_target_type = 'conversation_action_plan'),
  check (
    (approval_mode = 'none'
      and approval_id is null
      and approval_status = 'not_required')
    or (approval_mode = 'single'
      and approval_id is not null
      and approval_status = 'approved')
  ),
  check (jsonb_typeof(payload_json) = 'object'),
  check (coalesce(payload_json ->> 'schemaVersion' = '1', false)),
  check (coalesce(payload_json ->> 'tenantId' = tenant_id, false)),
  check (coalesce(payload_json #>> '{plan,id}' = plan_id, false)),
  check (coalesce(
    payload_json #>> '{plan,fingerprint}' = plan_fingerprint,
    false
  )),
  check (coalesce(payload_json #>> '{approval,mode}' = approval_mode, false)),
  check (coalesce(
    payload_json #>> '{approval,status}' = approval_status,
    false
  )),
  check (
    coalesce(
      jsonb_typeof(payload_json -> 'approval') = 'object'
      and (payload_json -> 'approval') ? 'id'
      and (
        (approval_id is null
          and payload_json #> '{approval,id}' = 'null'::jsonb)
        or payload_json #>> '{approval,id}' = approval_id
      ),
      false
    )
  ),
  check (
    coalesce(
      payload_json #>> '{catalog,fingerprint}' ~ '^[a-f0-9]{64}$'
      and jsonb_typeof(payload_json #> '{catalog,projection}') = 'object'
      and payload_json #>> '{catalog,projection,projectionSchemaVersion}' = '1'
      and payload_json #>> '{catalog,projection,manifestSchemaVersion}' = '1'
      and payload_json #>> '{catalog,projection,providerKey}' = 'tradikom_mock'
      and payload_json #>> '{catalog,projection,providerVersion}' = '1.0.0'
      and payload_json #>> '{catalog,projection,executionEnvironment}' = 'mock'
      and payload_json #>> '{catalog,projection,status}' = 'mock'
      and payload_json #>> '{catalog,projection,auth}' = 'none'
      and payload_json #> '{catalog,projection,allowedRoles}' =
        '["administrator", "collaborator", "manager", "owner"]'::jsonb
      and jsonb_typeof(
        payload_json #> '{catalog,projection,capabilities}'
      ) = 'array'
      and jsonb_array_length(
        payload_json #> '{catalog,projection,capabilities}'
      ) between 1 and 256,
      false
    )
  ),
  check (
    coalesce(
      payload_json #>> '{provider,key}' = 'tradikom_mock'
      and payload_json #>> '{provider,version}' = '1.0.0'
      and payload_json #>> '{provider,executionEnvironment}' = 'mock'
      and payload_json #>> '{provider,version}' =
        payload_json #>> '{catalog,projection,providerVersion}',
      false
    )
  ),
  check (
    coalesce(
      payload_json #>> '{authorization,role}' in (
        'owner', 'administrator', 'manager', 'collaborator'
      )
      and payload_json #> '{authorization,allowedRoles}' =
        '["administrator", "collaborator", "manager", "owner"]'::jsonb,
      false
    )
  ),
  check (
    coalesce(
      payload_json #> '{authorization,requiredScopes}' in (
        '["crm.contacts.read"]'::jsonb,
        '["project.tasks.write"]'::jsonb,
        '["crm.contacts.read", "project.tasks.write"]'::jsonb
      ),
      false
    )
  ),
  check (
    coalesce(
      payload_json -> 'capabilities' in (
        '["crm.contacts.search"]'::jsonb,
        '["project.task.create"]'::jsonb,
        '["crm.contacts.search", "project.task.create"]'::jsonb
      ),
      false
    )
  ),
  check (
    coalesce(
      payload_json #>> '{risk,maximum}' in (
        'low', 'medium', 'high', 'critical'
      ),
      false
    )
  ),
  check (
    coalesce(
      jsonb_typeof(payload_json #> '{risk,steps}') = 'array'
      and jsonb_array_length(payload_json #> '{risk,steps}') between 1 and 12,
      false
    )
  ),
  check (char_length(payload_json::text) between 2 and 64000)
);

create index if not exists idx_conversation_plan_policy_receipts_tenant_approval
  on conversation_action_plan_policy_receipts (
    tenant_id, approval_id, created_at, plan_id
  ) where approval_id is not null;

create index if not exists idx_conversation_plan_policy_receipts_tenant_created
  on conversation_action_plan_policy_receipts (tenant_id, created_at desc, plan_id);

create index if not exists idx_conversation_plan_policy_receipts_tenant_principal
  on conversation_action_plan_policy_receipts (
    tenant_id, approved_by_user_id, created_at desc, plan_id
  );

create or replace function enforce_conversation_action_plan_policy_receipt_binding()
returns trigger
language plpgsql
as $$
declare
  target_plan_status text;
begin
  select plan.approval_status
    into target_plan_status
  from conversation_action_plans plan
  where plan.tenant_id = new.tenant_id
    and plan.id = new.plan_id
    and plan.plan_fingerprint = new.plan_fingerprint
    and plan.decided_by = new.approved_by_user_id;

  if target_plan_status is distinct from 'approved' then
    raise exception 'conversation_action_plan_policy_receipt_binding_invalid';
  end if;

  if new.approval_mode = 'none' and exists (
    select 1
    from approvals approval
    where approval.tenant_id = new.tenant_id
      and approval.target_type = 'conversation_action_plan'
      and approval.target_id = new.plan_id
  ) then
    raise exception 'conversation_action_plan_policy_receipt_binding_invalid';
  end if;

  return new;
end;
$$;

drop trigger if exists conversation_action_plan_policy_receipts_binding
  on conversation_action_plan_policy_receipts;
create trigger conversation_action_plan_policy_receipts_binding
before insert on conversation_action_plan_policy_receipts
for each row execute function enforce_conversation_action_plan_policy_receipt_binding();

create or replace function reject_conversation_action_plan_policy_receipt_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from tenants tenant where tenant.id = old.tenant_id
  ) then
    return old;
  end if;
  raise exception 'conversation_action_plan_policy_receipt_immutable';
end;
$$;

drop trigger if exists conversation_action_plan_policy_receipts_immutable
  on conversation_action_plan_policy_receipts;
create trigger conversation_action_plan_policy_receipts_immutable
before update or delete on conversation_action_plan_policy_receipts
for each row execute function reject_conversation_action_plan_policy_receipt_mutation();
