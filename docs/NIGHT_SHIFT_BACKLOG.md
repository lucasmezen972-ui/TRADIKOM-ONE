# Night Shift Backlog

Phase 2 has no unfinished blockers. PR #2 remains isolated.

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

Next unfinished work:

1. Add the official OAuth metadata importer.
2. Keep live writes, production connector approval and unrestricted crawling disabled.
