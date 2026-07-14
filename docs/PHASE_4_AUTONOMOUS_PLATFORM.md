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

Focused tests cover evidence and deduplication, planning approval, public snapshot immutability, publication-count stability, rollback, stale-write protection, transactional failure rollback, tenant authorization, restricted-role PostgreSQL isolation, command-center routing and Playwright. The validation pass also found and fixed a demo-seed path that republished a pending draft when the demo was reopened. Final head `ab1c344b78ef074b6e5b2f0ad193c43ff7762118` passed complete GitHub Actions run `29341752287` in 6m55s, including eight Playwright scenarios.

## Sales AI

The fifth vertical slice adds explainable CRM prioritization without creating a predictive-data fiction or an outbound sales channel.

Implemented behavior:

- Active opportunities receive a deterministic follow-up score, indicative closing potential, confidence and low/medium/high priority.
- Rules use only the tenant-scoped pipeline stage, recorded value, next action, recent CRM activity, open/overdue tasks and assignment state.
- Six immutable evidence records explain every current assessment. A changed CRM signal creates a new version and supersedes the previous version transactionally.
- Closing or losing an opportunity supersedes its current assessment. Repeated analysis of unchanged same-day evidence is deduplicated.
- A unique current-assessment index and opportunity row locks serialize concurrent generation.
- Owner, administrator and manager roles may generate; other tenant members receive a read-only view.
- The French `Assistant commercial` workspace provides direct links back to existing opportunity records and contains no send, quote, price or discount control.
- Audit metadata records counts, generation version and explicit false flags for external action, message, quotation and discount generation without storing customer content.

Runtime migrations `035`/`036` and SQL mirrors `0029`/`0030` add tenant-owned assessments and evidence with composite opportunity relations, tenant-leading indexes and PostgreSQL RLS. Tests cover scoring, evidence, deduplication, versioning, closed opportunities, injected transactional rollback, application authorization, restricted-role cross-tenant read/insert/update/delete denial, the absence of operational side effects and Playwright. Head `6a9348048fb0cfbfc463f8d1869114672d5128eb` passed complete GitHub Actions run `29343934205` in 5m46s, including nine Playwright scenarios.

## Reputation AI

The sixth vertical slice creates a tenant-owned review inbox and explainable response drafts without monitoring, fetching or publishing on an external platform.

Implemented behavior:

- Authorized operators can manually import bounded reviews from a declared source, optional rating, optional public alias and occurrence date. Each immutable review is deduplicated by a content hash.
- Deterministic French lexical rules classify positive, neutral or negative sentiment, confidence and risk from the imported text and declared rating.
- Every proposal explicitly records that authenticity is not assessed. It never claims fake-review detection, author verification or competitor attribution.
- Proposals include a response draft, an internal improvement plan, rationale and immutable evidence for the declared source, text analysis and rating when present.
- Submission, approval and rejection are tenant-scoped, require an authorized role and preserve generic approval plus decision history. Approval means reviewed draft only.
- The command center routes pending review-response decisions to the French `Réputation` workspace.
- Audit metadata stores counts and safety flags without storing review or response contents. No activity, notification, domain event, external fetch, response send or website publication is triggered.
- The expanded desktop navigation is scrollable and keeps the session controls outside the navigation hit area.

Runtime migrations `037`/`038` and SQL mirrors `0031`/`0032` add reviews, response proposals, evidence and decisions with composite tenant relations, tenant-leading indexes and PostgreSQL RLS. Tests cover deterministic sentiment, evidence, deduplication, approvals and rejections, safe audit metadata, forced transactional rollback, application authorization, restricted-role cross-tenant CRUD and foreign relations, dashboard routing, no operational side effects and Playwright.

Initial CI run `29346153870` exposed a missing shared dashboard approval type. Run `29346380889` then exposed the required PostgreSQL approval policy field. Run `29346943623` made all non-browser gates green and revealed a real navigation overlap after the new module was added. Final head `0f783bc5fead15ee72ff3a03eb311898185e81ce` passed complete GitHub Actions run `29347576934` in 7m19s, including ten Playwright scenarios.

Current limitations remain deliberate: reviews must be imported manually, authenticity is not evaluated, external review platforms are not monitored, and approved drafts cannot be sent or published from TRADIKOM ONE.

## Competitor Intelligence

The seventh vertical slice records legal public competitor observations manually and turns them into evidence-backed planning proposals without crawling or scraping.

Implemented behavior:

- Tenant-owned competitor profiles store only a name and optional normalized public HTTPS reference. The platform never opens that reference automatically.
- Authorized operators record immutable observations across price, website, SEO, service, product, Google position, advertising, public social activity, reviews, opening hours, jobs and partnerships.
- Every observation requires a declared direction, public source type, HTTPS evidence URL, factual title and summary, occurrence date and explicit confirmations that the source is public and protected/private content was excluded.
- Stored source references remove query strings, fragments and credentials; sensitive URL parameters and local/non-public references are rejected before persistence.
- Deterministic rules compare the latest two observations per competitor/category, preserve immutable evidence and classify only `opportunity`, `risk` or `watch` with a confidence score and internal recommendation.
- A single observation remains a baseline and explicitly requires a second public proof before a trend can be asserted.
- Submission, approval and rejection use tenant-scoped generic approvals and immutable decision history. Approval is planning-only and cannot change prices, launch campaigns, contact competitors or trigger a workflow.
- The French `Veille concurrentielle` workspace and command center expose the complete evidence/decision path. Audit metadata excludes source URLs and observation text.

Runtime migrations `039`/`040` and SQL mirrors `0033`/`0034` add profiles, observations, insights, evidence and decisions with tenant-leading indexes, composite tenant relations and PostgreSQL RLS. Tests cover URL safety, deduplication, evidence comparison, proposal versioning, pending supersession, approval/rejection, safe audit metadata, forced rollback, application authorization, restricted-role cross-tenant CRUD and relations, command-center routing, no operational side effects and Playwright.

Head `86786830a0c36b561a1ce37e543c4520062cab3b` passed complete GitHub Actions run `29350066863` on the first attempt in 7m30s, including eleven Playwright scenarios. Automatic monitoring, network fetches, search-position collection and protected-content scraping remain intentionally unavailable.
