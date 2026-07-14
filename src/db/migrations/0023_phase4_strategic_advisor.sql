create table if not exists strategic_recommendations (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  rule_key text not null check (char_length(rule_key) between 3 and 160),
  fingerprint text not null check (char_length(fingerprint) = 64),
  advisor_role text not null check (advisor_role in (
    'executive', 'marketing', 'sales', 'operations', 'finance',
    'reputation', 'technology'
  )),
  title text not null check (char_length(title) between 5 and 160),
  rationale text not null check (char_length(rationale) between 10 and 1200),
  expected_gain text not null check (char_length(expected_gain) between 5 and 500),
  effort text not null check (effort in ('low', 'medium', 'high')),
  roi_summary text not null check (char_length(roi_summary) between 5 and 500),
  risk_summary text not null check (char_length(risk_summary) between 5 and 500),
  confidence integer not null check (confidence between 0 and 100),
  action_label text not null check (char_length(action_label) between 3 and 80),
  action_href text not null check (
    char_length(action_href) between 1 and 300 and substr(action_href, 1, 1) = '/'
  ),
  status text not null check (status in (
    'proposed', 'approved', 'rejected', 'superseded', 'expired'
  )),
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
  unique (tenant_id, rule_key, fingerprint),
  check (
    (status in ('proposed', 'superseded', 'expired') and decided_by is null
      and decision_reason is null and decided_at is null)
    or (status in ('approved', 'rejected') and decided_by is not null
      and decision_reason is not null and decided_at is not null)
  )
);

create table if not exists strategic_recommendation_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  recommendation_id text not null,
  evidence_type text not null check (evidence_type in (
    'business_brain_entry', 'system_metric', 'audit_record', 'api_source'
  )),
  evidence_ref text not null check (char_length(evidence_ref) between 1 and 300),
  label text not null check (char_length(label) between 3 and 160),
  observed_value text not null check (char_length(observed_value) between 1 and 500),
  captured_at text not null,
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, recommendation_id)
    references strategic_recommendations(tenant_id, id) on delete cascade
);

create table if not exists strategic_recommendation_decisions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  recommendation_id text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text not null check (char_length(reason) between 5 and 500),
  decided_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, recommendation_id)
    references strategic_recommendations(tenant_id, id) on delete cascade
);

create index if not exists idx_strategic_recommendations_tenant_status
  on strategic_recommendations(tenant_id, status, created_at desc);

create index if not exists idx_strategic_recommendations_tenant_role
  on strategic_recommendations(tenant_id, advisor_role, updated_at desc);

create index if not exists idx_strategic_evidence_tenant_recommendation
  on strategic_recommendation_evidence(
    tenant_id, recommendation_id, captured_at desc
  );

create index if not exists idx_strategic_decisions_tenant_recommendation
  on strategic_recommendation_decisions(
    tenant_id, recommendation_id, created_at desc
  );
