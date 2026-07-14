create table if not exists reputation_reviews (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  source text not null check (source in (
    'google', 'facebook', 'instagram', 'tripadvisor', 'trustpilot',
    'industry_directory', 'direct_feedback', 'manual_import'
  )),
  external_ref text check (external_ref is null or char_length(external_ref) <= 200),
  reviewer_alias text check (
    reviewer_alias is null or char_length(reviewer_alias) <= 100
  ),
  rating integer check (rating is null or rating between 1 and 5),
  review_text text not null check (char_length(review_text) between 3 and 3000),
  content_hash text not null check (char_length(content_hash) = 64),
  occurred_at text not null,
  imported_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, content_hash)
);

create table if not exists reputation_response_proposals (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  review_id text not null,
  fingerprint text not null check (char_length(fingerprint) = 64),
  sentiment text not null check (sentiment in ('positive', 'neutral', 'negative')),
  confidence integer not null check (confidence between 0 and 100),
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  authenticity_status text not null check (authenticity_status = 'not_assessed'),
  rationale text not null check (char_length(rationale) between 10 and 1000),
  response_draft text not null check (char_length(response_draft) between 10 and 1500),
  improvement_plan text not null check (
    char_length(improvement_plan) between 10 and 1500
  ),
  status text not null check (status in (
    'proposed', 'pending_approval', 'approved', 'rejected', 'superseded'
  )),
  version integer not null check (version >= 1),
  supersedes_id text,
  generation_version text not null check (char_length(generation_version) <= 80),
  generated_by text not null references users(id),
  decided_by text references users(id),
  decision_reason text check (
    decision_reason is null or char_length(decision_reason) <= 500
  ),
  decided_at text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, review_id, fingerprint),
  foreign key (tenant_id, review_id)
    references reputation_reviews(tenant_id, id) on delete cascade,
  foreign key (tenant_id, supersedes_id)
    references reputation_response_proposals(tenant_id, id) on delete restrict,
  check (
    (status in ('proposed', 'pending_approval', 'superseded')
      and decided_by is null and decision_reason is null and decided_at is null)
    or (status in ('approved', 'rejected')
      and decided_by is not null and decision_reason is not null and decided_at is not null)
  )
);

create table if not exists reputation_proposal_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  proposal_id text not null,
  evidence_type text not null check (evidence_type in (
    'review_source', 'review_rating', 'review_text'
  )),
  evidence_ref text not null check (char_length(evidence_ref) between 1 and 300),
  label text not null check (char_length(label) between 3 and 160),
  observed_value text not null check (char_length(observed_value) between 1 and 500),
  captured_at text not null,
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, proposal_id)
    references reputation_response_proposals(tenant_id, id) on delete cascade
);

create table if not exists reputation_proposal_decisions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  proposal_id text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text not null check (char_length(reason) between 5 and 500),
  decided_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, proposal_id)
    references reputation_response_proposals(tenant_id, id) on delete cascade
);

create index if not exists idx_reputation_reviews_tenant_occurred
  on reputation_reviews(tenant_id, occurred_at desc);

create index if not exists idx_reputation_proposals_tenant_status
  on reputation_response_proposals(tenant_id, status, updated_at desc);

create index if not exists idx_reputation_proposals_tenant_review
  on reputation_response_proposals(tenant_id, review_id, version desc);

create index if not exists idx_reputation_evidence_tenant_proposal
  on reputation_proposal_evidence(tenant_id, proposal_id, captured_at desc);

create index if not exists idx_reputation_decisions_tenant_proposal
  on reputation_proposal_decisions(tenant_id, proposal_id, created_at desc);
