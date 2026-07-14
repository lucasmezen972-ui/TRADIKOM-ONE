create unique index if not exists uq_software_domains_id_software
  on software_domains(id, software_id);

create table if not exists api_discovery_candidates (
  id text primary key,
  software_id text not null references software_directory_entries(id) on delete cascade,
  domain_id text not null,
  canonical_url text not null unique check (char_length(canonical_url) <= 2048),
  source_type text not null check (char_length(source_type) <= 80),
  confidence integer not null check (confidence between 0 and 100),
  discovery_reason text not null check (char_length(discovery_reason) <= 240),
  sitemap_url text not null check (char_length(sitemap_url) <= 2048),
  parser_version text not null check (char_length(parser_version) <= 80),
  status text not null check (status in ('under_review', 'accepted', 'rejected')),
  api_source_id text references api_sources(id) on delete set null,
  discovered_at text not null,
  last_seen_at text not null,
  decided_by text references users(id),
  decided_at text,
  decision_reason text check (
    decision_reason is null or char_length(decision_reason) <= 500
  ),
  created_at text not null,
  updated_at text not null,
  foreign key (domain_id, software_id)
    references software_domains(id, software_id) on delete cascade,
  check (
    (status = 'under_review' and decided_by is null and decided_at is null
      and api_source_id is null)
    or (status = 'accepted' and decided_by is not null and decided_at is not null
      and api_source_id is not null)
    or (status = 'rejected' and decided_by is not null and decided_at is not null
      and api_source_id is null)
  )
);

create index if not exists idx_api_discovery_candidates_review
  on api_discovery_candidates(status, confidence desc, last_seen_at desc);

create index if not exists idx_api_discovery_candidates_domain
  on api_discovery_candidates(domain_id, last_seen_at desc);
