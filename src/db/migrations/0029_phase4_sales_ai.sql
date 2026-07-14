create unique index if not exists uq_opportunities_tenant_id
  on opportunities(tenant_id, id);

create table if not exists sales_ai_assessments (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  opportunity_id text not null,
  fingerprint text not null check (char_length(fingerprint) = 64),
  status text not null check (status in ('current', 'superseded')),
  score integer not null check (score between 0 and 100),
  closing_estimate integer not null check (closing_estimate between 0 and 100),
  confidence integer not null check (confidence between 0 and 100),
  priority text not null check (priority in ('low', 'medium', 'high')),
  title text not null check (char_length(title) between 5 and 160),
  rationale text not null check (char_length(rationale) between 10 and 1200),
  recommended_action text not null check (
    char_length(recommended_action) between 5 and 500
  ),
  risk_summary text not null check (char_length(risk_summary) between 5 and 500),
  action_label text not null check (char_length(action_label) between 3 and 80),
  action_href text not null check (
    char_length(action_href) between 1 and 300 and substr(action_href, 1, 1) = '/'
  ),
  version integer not null check (version >= 1),
  supersedes_id text,
  generation_version text not null check (char_length(generation_version) <= 80),
  generated_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, opportunity_id)
    references opportunities(tenant_id, id) on delete cascade,
  foreign key (tenant_id, supersedes_id)
    references sales_ai_assessments(tenant_id, id) on delete restrict
);

create table if not exists sales_ai_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  assessment_id text not null,
  evidence_type text not null check (evidence_type in (
    'opportunity_stage', 'opportunity_value', 'follow_up',
    'recent_activity', 'open_tasks', 'assignment'
  )),
  evidence_ref text not null check (char_length(evidence_ref) between 1 and 300),
  label text not null check (char_length(label) between 3 and 160),
  observed_value text not null check (char_length(observed_value) between 1 and 500),
  captured_at text not null,
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, assessment_id)
    references sales_ai_assessments(tenant_id, id) on delete cascade
);

create index if not exists idx_sales_ai_assessments_tenant_status
  on sales_ai_assessments(tenant_id, status, priority, updated_at desc);

create index if not exists idx_sales_ai_assessments_tenant_opportunity
  on sales_ai_assessments(tenant_id, opportunity_id, version desc);

create index if not exists idx_sales_ai_assessments_tenant_fingerprint
  on sales_ai_assessments(tenant_id, opportunity_id, fingerprint);

create unique index if not exists uq_sales_ai_assessments_current
  on sales_ai_assessments(tenant_id, opportunity_id)
  where status = 'current';

create index if not exists idx_sales_ai_evidence_tenant_assessment
  on sales_ai_evidence(tenant_id, assessment_id, captured_at desc);
