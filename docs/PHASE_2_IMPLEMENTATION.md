# Phase 2 Implementation

## Implemented in this branch

- Added GitHub Actions CI with PostgreSQL 17 service, frozen pnpm install, migration verification, lint, typecheck, unit/integration tests, production build, and Playwright E2E.
- Added PostgreSQL/Drizzle foundation under `src/db/` with schema, client, migrations, tenant transaction helper, and repository guidance.
- Kept PGlite as a local fallback only when `DATABASE_URL` is absent outside production.
- Added Phase 2 migrations for hashed session tokens, published/draft website version pointers, domain events, rate limits, generation records, and encrypted connector secret versions.
- Added RLS migration draft with tenant context helpers and policies for key tenant-owned tables.
- Hardened sessions so cookies store raw tokens while the database stores token hashes; logout revokes the database session.
- Gated public demo outside local development unless `FEATURE_PUBLIC_DEMO=true`.
- Introduced workflow definition schema, domain event enqueueing, a workflow action executor, and a worker entry point.
- Switched lead follow-up behavior to the workflow engine rather than inline special-case task creation.
- Added Connector SDK contracts, registry, robust CSV parsing, webhook HMAC helper, and AES-256-GCM credential encryption helpers.
- Added AI provider abstraction with deterministic provider and optional OpenAI provider wrapper.
- Changed public website rendering to load the last immutable published snapshot.
- Added explicit public form idempotency keys, honeypot field, and visible consent checkbox.
- Added tests for session revocation, published snapshot safety, and quoted CSV values.

## Still incomplete

- Full service modularization is started but the legacy `src/lib/services.ts` remains the central adapter.
- RLS is present as SQL migration but local automated RLS tests still need a dedicated non-owner PostgreSQL role.
- Password reset, invitations, role administration, CRM mutation depth, approval workflows, delayed workflows, and connector UI mapping are not complete.
- The worker is a foundation entry point, not a long-running durable dispatcher yet.
