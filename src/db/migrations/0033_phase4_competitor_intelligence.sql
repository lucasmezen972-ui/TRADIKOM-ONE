create table if not exists competitor_profiles (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  website_url text check (website_url is null or char_length(website_url) <= 500),
  status text not null check (status in ('active', 'archived')),
  created_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id)
);

create unique index if not exists idx_competitor_profiles_tenant_name
  on competitor_profiles(tenant_id, lower(name));

create table if not exists competitor_observations (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  competitor_id text not null,
  category text not null check (category in (
    'price', 'website', 'seo', 'service', 'product', 'google_position',
    'advertising', 'social_activity', 'review', 'opening_hours', 'job',
    'partnership'
  )),
  direction text not null check (direction in (
    'increase', 'decrease', 'new', 'removed', 'changed',
    'positive_signal', 'negative_signal'
  )),
  source_type text not null check (source_type in (
    'official_website', 'public_search', 'public_social', 'public_directory',
    'public_ad', 'public_job', 'public_review', 'public_announcement'
  )),
  source_url text not null check (char_length(source_url) between 10 and 500),
  title text not null check (char_length(title) between 3 and 160),
  summary text not null check (char_length(summary) between 10 and 2000),
  observed_value text check (
    observed_value is null or char_length(observed_value) <= 300
  ),
  content_hash text not null check (char_length(content_hash) = 64),
  observed_at text not null,
  recorded_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, competitor_id, content_hash),
  foreign key (tenant_id, competitor_id)
    references competitor_profiles(tenant_id, id) on delete cascade
);

create table if not exists competitor_insights (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  competitor_id text not null,
  category text not null check (category in (
    'price', 'website', 'seo', 'service', 'product', 'google_position',
    'advertising', 'social_activity', 'review', 'opening_hours', 'job',
    'partnership'
  )),
  latest_observation_id text not null,
  previous_observation_id text,
  fingerprint text not null check (char_length(fingerprint) = 64),
  impact text not null check (impact in ('opportunity', 'risk', 'watch')),
  confidence integer not null check (confidence between 0 and 100),
  title text not null check (char_length(title) between 3 and 180),
  rationale text not null check (char_length(rationale) between 10 and 1200),
  recommended_action text not null check (
    char_length(recommended_action) between 10 and 1200
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
  unique (tenant_id, competitor_id, category, fingerprint),
  foreign key (tenant_id, competitor_id)
    references competitor_profiles(tenant_id, id) on delete cascade,
  foreign key (tenant_id, latest_observation_id)
    references competitor_observations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, previous_observation_id)
    references competitor_observations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, supersedes_id)
    references competitor_insights(tenant_id, id) on delete restrict,
  check (
    (status in ('proposed', 'pending_approval', 'superseded')
      and decided_by is null and decision_reason is null and decided_at is null)
    or (status in ('approved', 'rejected')
      and decided_by is not null and decision_reason is not null and decided_at is not null)
  )
);

create table if not exists competitor_insight_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  insight_id text not null,
  observation_id text not null,
  label text not null check (char_length(label) between 3 and 160),
  observed_value text not null check (char_length(observed_value) between 1 and 500),
  captured_at text not null,
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, insight_id)
    references competitor_insights(tenant_id, id) on delete cascade,
  foreign key (tenant_id, observation_id)
    references competitor_observations(tenant_id, id) on delete restrict
);

create table if not exists competitor_insight_decisions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  insight_id text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text not null check (char_length(reason) between 5 and 500),
  decided_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, insight_id)
    references competitor_insights(tenant_id, id) on delete cascade
);

create index if not exists idx_competitor_profiles_tenant_status
  on competitor_profiles(tenant_id, status, updated_at desc);

create index if not exists idx_competitor_observations_tenant_competitor
  on competitor_observations(tenant_id, competitor_id, category, observed_at desc);

create index if not exists idx_competitor_insights_tenant_status
  on competitor_insights(tenant_id, status, updated_at desc);

create index if not exists idx_competitor_insights_tenant_competitor
  on competitor_insights(tenant_id, competitor_id, category, version desc);

create index if not exists idx_competitor_evidence_tenant_insight
  on competitor_insight_evidence(tenant_id, insight_id, captured_at desc);

create index if not exists idx_competitor_decisions_tenant_insight
  on competitor_insight_decisions(tenant_id, insight_id, created_at desc);
