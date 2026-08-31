create table if not exists conversation_action_plans (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  thread_id text not null,
  source_message_id text not null,
  schema_version integer not null,
  generation_source text not null,
  model_reference text,
  approval_status text not null,
  intent text not null,
  business_goal text not null,
  confidence real not null,
  risk_summary text not null,
  estimated_cost_minor integer not null default 0,
  estimated_cost_currency text not null default 'EUR',
  plan_json text not null,
  plan_fingerprint text not null,
  created_by text not null references users(id) on delete restrict,
  created_at text not null,
  updated_at text not null,
  decided_by text references users(id) on delete restrict,
  decided_at text,
  decision_reason text,
  unique (tenant_id, id),
  unique (tenant_id, source_message_id, plan_fingerprint),
  foreign key (tenant_id, thread_id)
    references conversation_threads(tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_message_id)
    references conversation_messages(tenant_id, id) on delete restrict,
  check (schema_version = 1),
  check (generation_source in ('deterministic_mock', 'model')),
  check (
    (generation_source = 'model' and model_reference is not null) or
    (generation_source = 'deterministic_mock' and model_reference is null)
  ),
  check (approval_status in (
    'draft', 'awaiting_approval', 'approved', 'rejected', 'executed'
  )),
  check (char_length(intent) between 1 and 2000),
  check (char_length(business_goal) between 1 and 2000),
  check (confidence between 0 and 1),
  check (char_length(risk_summary) between 1 and 2000),
  check (estimated_cost_minor >= 0),
  check (estimated_cost_currency ~ '^[A-Z]{3}$'),
  check (char_length(plan_json) between 2 and 64000),
  check (plan_fingerprint ~ '^[A-Fa-f0-9]{64}$'),
  check (updated_at >= created_at),
  check (
    (approval_status in ('draft', 'awaiting_approval') and
      decided_at is null and decided_by is null and decision_reason is null) or
    (approval_status in ('approved', 'rejected', 'executed') and
      decided_at is not null and decided_by is not null and
      decision_reason is not null and char_length(decision_reason) between 1 and 500)
  )
);

create table if not exists conversation_action_plan_steps (
  tenant_id text not null references tenants(id) on delete cascade,
  plan_id text not null,
  position integer not null,
  step_id text not null,
  capability text not null,
  mode text not null,
  execution_environment text not null,
  risk text not null,
  requires_approval integer not null,
  reversible text not null,
  input_json text not null,
  evidence_required_json text not null,
  idempotency_key text not null,
  status text not null,
  primary key (tenant_id, plan_id, position),
  unique (tenant_id, plan_id, step_id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, plan_id)
    references conversation_action_plans(tenant_id, id) on delete cascade,
  check (position between 0 and 11),
  check (char_length(step_id) between 1 and 160),
  check (capability ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  check (mode in ('read', 'write', 'execute', 'subscribe')),
  check (execution_environment = 'mock'),
  check (risk in ('low', 'medium', 'high', 'critical')),
  check (requires_approval in (0, 1)),
  check (reversible in ('true', 'false', 'compensation_only')),
  check (char_length(input_json) between 2 and 16000),
  check (char_length(evidence_required_json) between 2 and 16000),
  check (char_length(idempotency_key) between 8 and 160),
  check (status in ('planned', 'approved', 'running', 'succeeded', 'failed', 'cancelled'))
);

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
    or new.created_at is distinct from old.created_at then
    raise exception 'conversation_action_plan_immutable';
  end if;
  return new;
end;
$$;

create or replace function enforce_conversation_action_plan_step_immutability()
returns trigger language plpgsql as $$
begin
  if new.tenant_id is distinct from old.tenant_id
    or new.plan_id is distinct from old.plan_id
    or new.position is distinct from old.position
    or new.step_id is distinct from old.step_id
    or new.capability is distinct from old.capability
    or new.mode is distinct from old.mode
    or new.execution_environment is distinct from old.execution_environment
    or new.risk is distinct from old.risk
    or new.requires_approval is distinct from old.requires_approval
    or new.reversible is distinct from old.reversible
    or new.input_json is distinct from old.input_json
    or new.evidence_required_json is distinct from old.evidence_required_json
    or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'conversation_action_plan_step_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists conversation_action_plan_immutability
  on conversation_action_plans;
create trigger conversation_action_plan_immutability
before update on conversation_action_plans
for each row execute function enforce_conversation_action_plan_immutability();

drop trigger if exists conversation_action_plan_step_immutability
  on conversation_action_plan_steps;
create trigger conversation_action_plan_step_immutability
before update on conversation_action_plan_steps
for each row execute function enforce_conversation_action_plan_step_immutability();

create unique index if not exists uq_approvals_conversation_action_plan
  on approvals (tenant_id, target_type, target_id)
  where target_type = 'conversation_action_plan';
create index if not exists idx_conversation_action_plans_tenant_status
  on conversation_action_plans (tenant_id, approval_status, updated_at desc);
create index if not exists idx_conversation_action_plans_tenant_thread
  on conversation_action_plans (tenant_id, thread_id, created_at desc);
create index if not exists idx_conversation_action_plan_steps_tenant_capability
  on conversation_action_plan_steps (tenant_id, capability, status);
