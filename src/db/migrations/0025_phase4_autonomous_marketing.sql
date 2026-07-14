create table if not exists marketing_campaign_proposals (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  campaign_key text not null check (char_length(campaign_key) between 3 and 160),
  fingerprint text not null check (char_length(fingerprint) = 64),
  channel text not null check (channel in ('email', 'social', 'website')),
  title text not null check (char_length(title) between 5 and 160),
  subject text not null check (char_length(subject) <= 200),
  objective text not null check (char_length(objective) between 5 and 500),
  audience text not null check (char_length(audience) between 3 and 500),
  content text not null check (char_length(content) between 10 and 5000),
  call_to_action text not null check (char_length(call_to_action) between 2 and 80),
  expected_outcome text not null check (
    char_length(expected_outcome) between 5 and 500
  ),
  risk_summary text not null check (char_length(risk_summary) between 5 and 500),
  budget_cents integer check (budget_cents is null or budget_cents >= 0),
  starts_at text,
  ends_at text,
  status text not null check (status in (
    'draft', 'pending_approval', 'approved', 'rejected', 'superseded', 'archived'
  )),
  version integer not null check (version > 0),
  supersedes_id text,
  source_strategy_recommendation_id text,
  generation_version text not null check (char_length(generation_version) <= 80),
  created_by text not null references users(id),
  decided_by text references users(id),
  decision_reason text check (
    decision_reason is null or char_length(decision_reason) <= 500
  ),
  decided_at text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, campaign_key, version),
  unique (tenant_id, campaign_key, fingerprint),
  foreign key (tenant_id, supersedes_id)
    references marketing_campaign_proposals(tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_strategy_recommendation_id)
    references strategic_recommendations(tenant_id, id) on delete restrict,
  check (starts_at is null or ends_at is null or starts_at < ends_at),
  check (
    (status in ('draft', 'pending_approval', 'superseded', 'archived')
      and decided_by is null and decision_reason is null and decided_at is null)
    or (status in ('approved', 'rejected') and decided_by is not null
      and decision_reason is not null and decided_at is not null)
  )
);

create table if not exists marketing_campaign_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  proposal_id text not null,
  evidence_type text not null check (evidence_type in (
    'business_profile', 'business_brain_entry', 'strategic_recommendation'
  )),
  evidence_ref text not null check (char_length(evidence_ref) between 1 and 300),
  label text not null check (char_length(label) between 3 and 160),
  observed_value text not null check (char_length(observed_value) between 1 and 500),
  captured_at text not null,
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, proposal_id)
    references marketing_campaign_proposals(tenant_id, id) on delete cascade
);

create table if not exists marketing_campaign_decisions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  proposal_id text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text not null check (char_length(reason) between 5 and 500),
  decided_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, proposal_id)
    references marketing_campaign_proposals(tenant_id, id) on delete cascade
);

create index if not exists idx_marketing_proposals_tenant_status
  on marketing_campaign_proposals(tenant_id, status, updated_at desc);

create index if not exists idx_marketing_proposals_tenant_campaign
  on marketing_campaign_proposals(tenant_id, campaign_key, version desc);

create index if not exists idx_marketing_evidence_tenant_proposal
  on marketing_campaign_evidence(tenant_id, proposal_id, captured_at desc);

create index if not exists idx_marketing_decisions_tenant_proposal
  on marketing_campaign_decisions(tenant_id, proposal_id, created_at desc);
