alter table conversation_action_plans
  add column if not exists supersedes_plan_id text;

alter table conversation_action_plans
  add column if not exists revision_request_fingerprint text;

alter table conversation_action_plans
  drop constraint if exists conversation_action_plans_revision_pair_check;
alter table conversation_action_plans
  add constraint conversation_action_plans_revision_pair_check check (
    (supersedes_plan_id is null and revision_request_fingerprint is null)
    or (
      supersedes_plan_id is not null
      and supersedes_plan_id <> id
      and revision_request_fingerprint is not null
      and revision_request_fingerprint ~ '^[A-Fa-f0-9]{64}$'
    )
  );

alter table conversation_action_plans
  drop constraint if exists conversation_action_plans_supersedes_plan_fk;
alter table conversation_action_plans
  add constraint conversation_action_plans_supersedes_plan_fk
  foreign key (tenant_id, supersedes_plan_id)
  references conversation_action_plans(tenant_id, id) on delete cascade;

create unique index if not exists uq_conversation_action_plan_supersedes
  on conversation_action_plans (tenant_id, supersedes_plan_id)
  where supersedes_plan_id is not null;

create or replace function enforce_conversation_action_plan_revision_binding()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  previous_plan conversation_action_plans%rowtype;
begin
  if tg_op <> 'INSERT' or new.supersedes_plan_id is null then
    return new;
  end if;

  select * into previous_plan
  from conversation_action_plans
  where tenant_id = new.tenant_id and id = new.supersedes_plan_id;

  if not found
    or previous_plan.thread_id is distinct from new.thread_id
    or previous_plan.source_message_id is distinct from new.source_message_id
    or previous_plan.approval_status is distinct from 'rejected'
    or previous_plan.decided_by is distinct from new.created_by
    or previous_plan.decided_at is distinct from new.created_at
    or previous_plan.decision_reason is distinct from
      'Plan remplacé par une révision demandée.'
    or new.revision_request_fingerprint is null
    or new.approval_status is distinct from 'awaiting_approval'
    or new.decided_by is not null
    or new.decided_at is not null
    or new.decision_reason is not null
    or exists (
      select 1 from conversation_action_plan_policy_receipts receipt
      where receipt.tenant_id = previous_plan.tenant_id
        and receipt.plan_id = previous_plan.id
    )
    or exists (
      select 1 from workflow_runs run
      where run.tenant_id = previous_plan.tenant_id
        and run.workflow_key = 'conversation_plan:' || previous_plan.id
    )
    or exists (
      select 1 from conversation_action_plan_steps step
      where step.tenant_id = previous_plan.tenant_id
        and step.plan_id = previous_plan.id
        and step.status <> 'cancelled'
    )
    or not exists (
      select 1 from approvals approval
      where approval.tenant_id = previous_plan.tenant_id
        and approval.target_type = 'conversation_action_plan'
        and approval.target_id = previous_plan.id
        and approval.status = 'rejected'
    ) then
    raise exception 'conversation_action_plan_revision_binding_invalid';
  end if;

  return new;
end;
$$;

drop trigger if exists conversation_action_plan_revision_binding
  on conversation_action_plans;
create trigger conversation_action_plan_revision_binding
before insert or update on conversation_action_plans
for each row execute function enforce_conversation_action_plan_revision_binding();

create or replace function enforce_conversation_action_plan_immutability()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.thread_id is distinct from old.thread_id
    or new.source_message_id is distinct from old.source_message_id
    or new.schema_version is distinct from old.schema_version
    or new.generation_source is distinct from old.generation_source
    or new.model_reference is distinct from old.model_reference
    or new.intent is distinct from old.intent
    or new.business_goal is distinct from old.business_goal
    or new.confidence is distinct from old.confidence
    or new.risk_summary is distinct from old.risk_summary
    or new.estimated_cost_minor is distinct from old.estimated_cost_minor
    or new.estimated_cost_currency is distinct from old.estimated_cost_currency
    or new.plan_json is distinct from old.plan_json
    or new.plan_fingerprint is distinct from old.plan_fingerprint
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.supersedes_plan_id is distinct from old.supersedes_plan_id
    or new.revision_request_fingerprint is distinct from old.revision_request_fingerprint then
    raise exception 'conversation_action_plan_immutable';
  end if;
  return new;
end;
$$;
