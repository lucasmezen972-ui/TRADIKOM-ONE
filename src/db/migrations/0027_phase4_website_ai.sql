create unique index if not exists uq_websites_tenant_id
  on websites(tenant_id, id);

create unique index if not exists uq_website_sections_tenant_website_id
  on website_sections(tenant_id, website_id, id);

create table if not exists website_ai_proposals (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  website_id text not null,
  section_id text not null,
  proposal_key text not null check (char_length(proposal_key) between 3 and 160),
  fingerprint text not null check (char_length(fingerprint) = 64),
  proposal_type text not null check (proposal_type in (
    'seo_copy', 'faq_content', 'accessibility_copy'
  )),
  title text not null check (char_length(title) between 5 and 160),
  rationale text not null check (char_length(rationale) between 10 and 1000),
  expected_gain text not null check (char_length(expected_gain) between 5 and 500),
  risk_summary text not null check (char_length(risk_summary) between 5 and 500),
  proposed_title text not null check (char_length(proposed_title) between 1 and 300),
  proposed_body text not null check (char_length(proposed_body) between 1 and 5000),
  original_content_hash text not null check (char_length(original_content_hash) = 64),
  status text not null check (status in (
    'proposed', 'pending_approval', 'approved', 'rejected', 'applied',
    'superseded', 'stale'
  )),
  version integer not null check (version > 0),
  supersedes_id text,
  generation_version text not null check (char_length(generation_version) <= 80),
  created_by text not null references users(id),
  decided_by text references users(id),
  decision_reason text check (
    decision_reason is null or char_length(decision_reason) <= 500
  ),
  decided_at text,
  applied_by text references users(id),
  applied_at text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, proposal_key, fingerprint),
  foreign key (tenant_id, website_id)
    references websites(tenant_id, id) on delete cascade,
  foreign key (tenant_id, website_id, section_id)
    references website_sections(tenant_id, website_id, id) on delete cascade,
  foreign key (tenant_id, supersedes_id)
    references website_ai_proposals(tenant_id, id) on delete restrict,
  check (
    (status in ('proposed', 'pending_approval', 'superseded', 'stale')
      and decided_by is null and decision_reason is null and decided_at is null)
    or (status in ('approved', 'rejected', 'applied')
      and decided_by is not null and decision_reason is not null and decided_at is not null)
  ),
  check (
    (status = 'applied' and applied_by is not null and applied_at is not null)
    or (status <> 'applied' and applied_by is null and applied_at is null)
  )
);

create table if not exists website_ai_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  proposal_id text not null,
  evidence_type text not null check (evidence_type in (
    'business_profile', 'website_section'
  )),
  evidence_ref text not null check (char_length(evidence_ref) between 1 and 300),
  label text not null check (char_length(label) between 3 and 160),
  observed_value text not null check (char_length(observed_value) between 1 and 500),
  captured_at text not null,
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, proposal_id)
    references website_ai_proposals(tenant_id, id) on delete cascade
);

create table if not exists website_ai_decisions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  proposal_id text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text not null check (char_length(reason) between 5 and 500),
  decided_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, proposal_id)
    references website_ai_proposals(tenant_id, id) on delete cascade
);

create index if not exists idx_website_ai_proposals_tenant_status
  on website_ai_proposals(tenant_id, status, updated_at desc);

create index if not exists idx_website_ai_proposals_tenant_website
  on website_ai_proposals(tenant_id, website_id, proposal_key);

create index if not exists idx_website_ai_evidence_tenant_proposal
  on website_ai_evidence(tenant_id, proposal_id, captured_at desc);

create index if not exists idx_website_ai_decisions_tenant_proposal
  on website_ai_decisions(tenant_id, proposal_id, created_at desc);
