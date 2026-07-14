# Night Shift Backlog

Phase 2, Phase 3 and stabilization PR #4 are merged and green. Obsolete PR #2 is closed without merge. Phase 4 started from verified green `main` head `49c78d1` on `codex/phase-4-autonomous-platform`.

Completed for the first Phase 3 checkpoint:

1. Verified the Phase 3 gate from green `main` SHA `05a7c7a`.
2. Created `codex/phase-3-api-intelligence` without PR #2 changes.
3. Implemented the complete safe OpenAPI-to-sandbox-Connect-Store vertical slice.
4. Opened draft PR #3 and made both complete CI runs green at `e971d13`.

API Change Monitor checkpoint completed and green at `b0bd77f`:

1. Deterministic source, operation, schema, authentication, scope, webhook, version, rate-limit, deprecation and access-policy comparison.
2. Tenant impact records, automatic upgrade blocking, static change contracts, Opportunity Radar alerts and human repair decisions.
3. Runtime/SQL migrations with PostgreSQL RLS and cross-tenant relation tests.

Scheduled source rechecks completed and green at `76a1487`:

1. Platform-admin configuration for approved official sources, with hourly, six-hourly, daily or weekly intervals.
2. Worker claims with unique leases, stale-lease recovery, bounded batches, conditional HTTP validators and exponential backoff.
3. Safe terminal blocking for paused domains or revoked authority, persisted error codes without raw messages, and focused integration coverage.

Bounded Postman Collection v2.1 import completed and green at `a1fcaf1`:

1. Deterministic JSON-only parser with bounded size, depth, folders, variables, examples and scripts.
2. Safe import of request metadata, operations, authentication shape and evidence without values, bodies or script execution.
3. Authoritative snapshot recheck, platform-admin authorization, transactional persistence, audit coverage and deterministic change monitoring.

Supplied GraphQL import completed and green at `54b8199`:

1. Official `graphql` parser for bounded SDL and supplied introspection JSON, without live introspection.
2. Deterministic query, mutation, subscription and type extraction without descriptions, deprecation reasons or default values.
3. Transactional reviewed claims, stable evidence, compatibility reuse, change monitoring and audited vertical coverage.

Official OAuth metadata import completed and green at `df9198e`:

1. Bounded RFC 8414 JSON parsing for issuer, authorization/token/revocation endpoints, grants, response types, scopes, client authentication and PKCE support.
2. HTTPS/private-target validation, secret and signed-metadata redaction, authoritative replay, transactional reviewed claims and coexistence with an operation contract.
3. Deterministic change monitoring, tenant authorization, audited persistence, French administration controls and vertical regression coverage.

Approved-domain expansion completed and green at `7eb2833`:

1. Platform-admin sitemap discovery restricted to exact approved HTTPS domains, using `robots.txt` declarations or `/sitemap.xml` without redirects or subdomain traversal.
2. XML parsing bounded to 512 KiB, five sitemap documents, depth two and 100 candidates, with canonicalization, deduplication, sensitive-query rejection and rate limiting.
3. Every candidate remains under human review; acceptance creates only an official source record and never fetches, imports or activates a connector automatically.

Connector repair proposals completed and green at `2bd0881`:

1. An approved API impact can generate one separately versioned connector proposal only after the current snapshot and all its operations are imported and approved.
2. The original connector stays blocked; the replacement stays disabled and must pass mock contracts plus a fresh sandbox approval.
3. PostgreSQL RLS and relation triggers isolate repairs by tenant, while versioned imports preserve historical evidence referenced by approved mappings without carrying old approvals forward.

Reusable approved mapping intelligence completed and green at `4af425a`:

1. A platform administrator can promote only an already approved tenant mapping backed by an approved official source.
2. Global knowledge stores structural mapping fields and evidence only, without tenant IDs, sample values or automatic promotion.
3. Reuse in another tenant creates a deduplicated pending proposal that still requires an explicit tenant-scoped approval and audit.

Improved operational observability completed and green at `2747368`:

1. Platform administrators receive bounded health totals for approved sources, recheck state, pending sitemap decisions, reviewed claims and recent contract changes.
2. Tenant-scoped health totals cover pending mappings, blocked impacts, repair decisions, sandbox approvals, failed contracts and audited API Intelligence actions.
3. The read model exposes no raw source URLs, payloads, error messages, error codes or secrets and is covered for role and tenant isolation.

Next unfinished work:

1. Business Brain foundation is green at `1ea4e1e` in GitHub Actions run `29333961495`; draft PR #5 is open.
2. Strategic Advisor is green at `4fcb9e2` in complete GitHub Actions run `29335663755`, with evidence, explainability, planning-only approval and no execution side effects.
3. Autonomous Marketing is green at `1c2c8e3` in complete GitHub Actions run `29338101814`, with evidence, immutable revisions, approval and no launch/send/publish path.
4. Website AI is green at `ab1c344` in complete GitHub Actions run `29341752287`; demo reopening cannot publish a pending draft.
5. Sales AI is green at `6a93480` in complete GitHub Actions run `29343934205`, with explainable CRM evidence and no message, quotation, pricing or discount path.
6. Reputation AI is green at `0f783bc` in complete GitHub Actions run `29347576934`, with manual/imported evidence, explicit authenticity limits, planning-only approval and no external monitoring, send or publication path.
7. Competitor Intelligence is green at `8678683` in complete GitHub Actions run `29350066863`, with confirmed legal public observations, safe URL storage, evidence comparison and no network fetch, scraping or external reaction path.
8. Financial AI is green at `02eaa2c` in complete GitHub Actions run `29352582873`, with declared/versioned inputs, explainable formulas, strict unavailable states, tenant isolation and no accounting or external write path.
9. Continue with bounded AI Employee profiles: skills, memory scope, permissions, working hours, internal tools, approval limits, KPIs and immutable activity history.
10. Keep all external sends, connector activation, campaigns, payments, publication and production writes unavailable to AI employees unless a separately reviewed future execution path is explicitly approved.
