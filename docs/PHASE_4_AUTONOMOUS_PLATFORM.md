# Phase 4 - Autonomous Business Platform

## Verified entry state

- Phase 2, Phase 3 and Phase 3.5 are merged into `main`.
- Phase 4 entry-check head `49c78d1e4e720a9a0b32596f64c01d3ec8d3b70d` passed GitHub Actions run `29309008452`.
- Phase 4 implementation branch: `codex/phase-4-autonomous-platform`.
- Production connector activation, unrestricted crawling and production write operations remain disabled.

## Business Brain foundation

The first Phase 4 vertical slice creates a tenant-owned, evidence-backed business memory without copying existing CRM, website, workflow or connector records into another data silo.

Implemented behavior:

- `business_brain_entries` stores bounded business facts across company, customer, supplier, catalog, pricing, margin, objective, KPI, team, location, automation, website, API and connector domains.
- Every active fact has a confidence score, source classification, required evidence and reviewer identity.
- Revisions create an immutable new version and supersede the previous row transactionally.
- Archiving preserves history; no user-facing mutation deletes memory.
- Composite tenant foreign keys keep evidence and version ancestry inside one tenant.
- PostgreSQL RLS policies protect entries and evidence for restricted runtime roles.
- Reads combine manual memory with tenant-scoped signals from the Business Twin, CRM, memberships, workflows, websites, connectors and API Intelligence.
- Owner, administrator, manager and collaborator roles may write; read-only members can only inspect.
- Create, revise and archive operations are transactional and audited without logging fact contents.
- The French `Cerveau d'entreprise` workspace exposes coverage, current operational signals, evidence, versioning and safe empty/error states.

## Validation

Focused tests cover:

- immutable revision history;
- required evidence and transactional rollback;
- tenant authorization and cross-tenant denial;
- restricted-role PostgreSQL RLS for entries and evidence;
- audit events without memory contents;
- Business Twin and operational coverage signals;
- the browser flow for creation, revision and archival.

Local Node commands remain unreliable and were stopped after a bounded wait. `git diff --check` passed; GitHub Actions is the authoritative validation environment.

## Current limitations

- The Business Brain is a verified memory and read model, not yet an autonomous recommendation engine.
- Strategic Advisor recommendations, ROI scoring, approval queues and AI employee execution are not implemented by this checkpoint.
- No Phase 4 action can send external messages, activate connectors, launch campaigns or modify production systems automatically.
