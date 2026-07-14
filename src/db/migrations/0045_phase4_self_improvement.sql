create table if not exists self_improvement_proposals (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  proposal_key text not null check (char_length(proposal_key) between 3 and 220),
  category text not null check (category in (
    'workflow_failed', 'workflow_unused', 'connector_degraded',
    'connector_unused', 'contact_duplicates', 'seo_metadata', 'website_cta'
  )),
  entity_type text not null check (char_length(entity_type) between 3 and 80),
  entity_id text not null check (char_length(entity_id) between 1 and 200),
  title text not null check (char_length(title) between 3 and 180),
  explanation text not null check (char_length(explanation) between 10 and 1000),
  recommendation text not null check (char_length(recommendation) between 10 and 1200),
  action_label text not null check (char_length(action_label) between 3 and 100),
  action_href text not null check (char_length(action_href) between 1 and 240),
  severity text not null check (severity in ('critical', 'warning', 'info')),
  confidence integer not null check (confidence between 0 and 100),
  fingerprint text not null check (char_length(fingerprint) = 64),
  record_status text not null check (record_status in ('current', 'superseded', 'resolved')),
  decision_status text not null default 'pending' check (decision_status in ('pending', 'accepted', 'dismissed')),
  version integer not null check (version >= 1),
  supersedes_id text,
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, id, version),
  unique (tenant_id, proposal_key, version),
  foreign key (tenant_id, supersedes_id)
    references self_improvement_proposals(tenant_id, id) on delete restrict
);

create unique index if not exists idx_self_improvement_proposals_current
  on self_improvement_proposals(tenant_id, proposal_key)
  where record_status = 'current';

create index if not exists idx_self_improvement_proposals_tenant_status
  on self_improvement_proposals(tenant_id, record_status, decision_status, updated_at desc);

create table if not exists self_improvement_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  proposal_id text not null,
  proposal_version integer not null check (proposal_version >= 1),
  evidence_key text not null check (char_length(evidence_key) between 3 and 160),
  source_type text not null check (char_length(source_type) between 3 and 80),
  source_id text not null check (char_length(source_id) between 1 and 200),
  metric_name text not null check (char_length(metric_name) between 3 and 120),
  metric_value integer not null check (metric_value >= 0),
  summary text not null check (char_length(summary) between 10 and 500),
  observed_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, proposal_id, proposal_version, evidence_key),
  foreign key (tenant_id, proposal_id, proposal_version)
    references self_improvement_proposals(tenant_id, id, version) on delete restrict
);

create index if not exists idx_self_improvement_evidence_tenant_proposal
  on self_improvement_evidence(tenant_id, proposal_id, proposal_version);

create table if not exists self_improvement_decisions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  proposal_id text not null,
  proposal_version integer not null check (proposal_version >= 1),
  decision text not null check (decision in ('accepted', 'dismissed')),
  reason text not null check (char_length(reason) between 10 and 800),
  created_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, proposal_id, proposal_version),
  foreign key (tenant_id, proposal_id, proposal_version)
    references self_improvement_proposals(tenant_id, id, version) on delete restrict
);

create index if not exists idx_self_improvement_decisions_tenant_created
  on self_improvement_decisions(tenant_id, created_at desc);
