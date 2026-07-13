# Night Shift Backlog

Phase 2 has no unfinished blockers. PR #2 remains isolated.

Completed for the first Phase 3 checkpoint:

1. Verified the Phase 3 gate from green `main` SHA `05a7c7a`.
2. Created `codex/phase-3-api-intelligence` without PR #2 changes.
3. Implemented the complete safe OpenAPI-to-sandbox-Connect-Store vertical slice.
4. Opened draft PR #3 and made both complete CI runs green at `e971d13`.

API Change Monitor checkpoint implemented and awaiting authoritative CI:

1. Deterministic source, operation, schema, authentication, scope, webhook, version, rate-limit, deprecation and access-policy comparison.
2. Tenant impact records, automatic upgrade blocking, static change contracts, Opportunity Radar alerts and human repair decisions.
3. Runtime/SQL migrations with PostgreSQL RLS and cross-tenant relation tests.

Next unfinished work after green CI:

1. Add scheduled rechecks for approved official sources only.
2. Add Postman v2.1, supplied GraphQL and official OAuth metadata importers.
3. Keep live writes, production connector approval and unrestricted crawling disabled.
