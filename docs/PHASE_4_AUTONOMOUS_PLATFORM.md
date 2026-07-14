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

Local Node commands remain unreliable and were stopped after a bounded wait. `git diff --check` passed. Business Brain head `1ea4e1e280777ee17fe90fcc6e00c45aef93134d` passed complete GitHub Actions run `29333961495`: dependency audit, clean/upgrade migrations, backup/restore, lint, typecheck, unit/integration/PostgreSQL/RLS tests, production build and Playwright E2E.

## Current limitations

- The Strategic Advisor uses deterministic evidence rules. It does not send tenant data to an external model in this checkpoint.
- ROI is an explainable qualitative estimate until the tenant records validated costs, targets and realized gains.
- Recommendation approval means approved for planning only; it cannot trigger an external or production action.
- No Phase 4 action can send external messages, activate connectors, launch campaigns or modify production systems automatically.

## Strategic Advisor

The second vertical slice adds explainable recommendation proposals grounded in current Business Brain evidence.

Implemented behavior:

- Multi-role recommendations support direction, marketing, sales, operations, finance, reputation and technology viewpoints.
- Every proposal stores why it exists, confidence, expected gain, effort, ROI summary, risk summary, direct internal action and generation version.
- Every proposal has one or more immutable evidence citations; generation rules cannot persist an evidence-free recommendation.
- Deterministic fingerprints prevent duplicate proposals and supersede stale pending proposals when observed evidence changes.
- Owner, administrator and manager roles can generate and decide; other tenant members receive a read-only view.
- Pending recommendations use the existing approval queue and appear as strategic decisions in the command center.
- Approval and rejection require a reason, preserve decision history and audit `executionTriggered: false`.
- The French `Conseiller stratégique` workspace groups proposals by role and shows complete rationale and evidence before a decision.

Focused tests cover deduplication, changed-evidence supersession, required provenance, tenant authorization, restricted-role RLS, command-center approval routing and the absence of workflow, connector, activity or domain-event side effects after approval.

Strategic Advisor implementation head `ef9ee7de71a930e74b6fb30dd91752459f204d0d` passed every CI step except one ambiguous Playwright text selector in run `29335261251`. Test-only fix `4fcb9e2d572ac8c539ee2a862781bcd23ee31b21` made complete run `29335663755` green: dependency audit, migrations, backup/restore, lint, typecheck, unit/integration/PostgreSQL/RLS tests, production build and six Playwright scenarios.

## Autonomous Marketing

The third vertical slice prepares versioned marketing drafts from verified Business Twin fields. It does not send or publish content.

Implemented behavior:

- Deterministic email and social proposals use only the verified company identity, first recorded offer, target audience, objective and approved call to action.
- Every draft stores three immutable Business Twin evidence citations and a generation fingerprint; repeated generation does not duplicate a proposal.
- Revisions create a new draft version, supersede the previous version transactionally and preserve evidence history.
- Submission creates a tenant-scoped approval. Approval or rejection requires a reason and records a decision plus an audit event with `executionTriggered: false`.
- Approvals appear in the command center and route to the French `Marketing autonome` workspace.
- The workspace exposes factual content, risks, evidence, versions and safe role-aware controls. It intentionally has no launch, send or publish action.
- Composite tenant foreign keys and PostgreSQL RLS protect proposals, evidence and decisions.

Focused tests cover Business Twin requirements, evidence, prohibited-claim avoidance, generation deduplication, immutable revision, approval history, tenant authorization, restricted-role PostgreSQL isolation, command-center routing, Playwright and the absence of workflow, connector, notification, activity or domain-event side effects.

Local typecheck and `git diff --check` again stalled without diagnostics and were stopped after 30 seconds. Initial CI run `29337702194` passed migrations, lint and typecheck, then exposed an order-dependent evidence assertion. Test-only fix `1c2c8e3113dd5408204775fd7d74c1303a58babf` made complete run `29338101814` green: dependency audit, clean/upgrade migrations, backup/restore, lint, typecheck, unit/integration/PostgreSQL/RLS tests, production build and seven Playwright scenarios.

## Website AI

The fourth vertical slice proposes bounded copy improvements for the current website draft. It reuses the existing immutable website snapshots and publication boundary instead of creating a second website model.

Implemented behavior:

- Deterministic rules propose a clearer homepage hero and an aligned FAQ using only Business Twin identity, offer, area, description and FAQ evidence.
- Each proposal stores the analyzed section hash, proposed copy, rationale, expected gain, risk, evidence, generation version and immutable decision history.
- New source content produces a new proposal version and supersedes only open proposals; fingerprints prevent duplicate analysis.
- Submission and approval are explicit tenant-scoped actions. Applying an approved proposal updates only the editable section and creates an existing website draft snapshot.
- The public site continues reading its last immutable publication. Applying Website AI never inserts a publication or moves the public pointer.
- If a human changes the target section after analysis, application marks the proposal stale and preserves the human draft.
- Existing website version restoration remains the rollback mechanism.
- Owner, administrator and manager roles can generate, decide and apply; other tenant members receive a read-only view.

The read path uses two bounded tenant queries and returns at most 50 proposals; generation produces at most two proposals per analysis. Tenant-leading indexes, PostgreSQL RLS and composite tenant/website/section foreign keys protect proposals, evidence and decisions.

Focused tests cover evidence and deduplication, planning approval, public snapshot immutability, publication-count stability, rollback, stale-write protection, transactional failure rollback, tenant authorization, restricted-role PostgreSQL isolation, command-center routing and Playwright. CI validation is pending for this checkpoint.
