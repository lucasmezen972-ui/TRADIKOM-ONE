# Phase 2 Implementation

## Implemented in this branch

- Added GitHub Actions CI with PostgreSQL 17 service, frozen pnpm install, migration verification, lint, typecheck, unit/integration tests, production build, and Playwright E2E.
- Added PostgreSQL/Drizzle foundation under `src/db/` with schema, client, migrations, tenant transaction helper, and repository guidance.
- Kept PGlite as a local fallback only when `DATABASE_URL` is absent outside production.
- Added Phase 2 migrations for hashed session tokens, published/draft website version pointers, domain events, rate limits, generation records, and encrypted connector secret versions.
- Added RLS migration draft with tenant context helpers and policies for key tenant-owned tables.
- Added PostgreSQL RLS integration coverage that runs with `DATABASE_URL` and verifies restricted-role tenant isolation plus cross-tenant write rejection.
- Hardened sessions so cookies store raw tokens while the database stores token hashes; logout revokes the database session.
- Added password reset request and completion flows with hashed single-use tokens and session revocation after password change.
- Extracted authentication and session logic into `src/modules/auth/` with schemas, typed errors, repository functions, and a domain service while keeping `src/lib/services.ts` as the legacy adapter.
- Extracted tenant access, tenant creation, team invitations, member role management, and audit recording into bounded tenant/audit modules.
- Extracted public website lead ingestion into `src/modules/crm/` with schemas, typed errors, repository functions, idempotent public form submission handling, contact/lead/opportunity creation, audit preservation, and workflow dispatch preserved.
- Added invitation creation, acceptance, pending invitation display, and member role updates for non-owner roles.
- Gated public demo outside local development unless `FEATURE_PUBLIC_DEMO=true`.
- Introduced workflow definition schema, domain event enqueueing, a workflow action executor, and a worker entry point with durable batch processing, retries, and stale processing requeue.
- Switched lead follow-up behavior to the workflow engine rather than inline special-case task creation.
- Added Connector SDK contracts, registry, robust CSV parsing, webhook HMAC verification for configured endpoint secrets, and AES-256-GCM credential encryption helpers.
- Added AI provider abstraction with deterministic provider and optional OpenAI provider wrapper.
- Changed public website rendering to load the last immutable published snapshot.
- Added explicit public form idempotency keys, honeypot field, and visible consent checkbox.
- Added tests for session revocation, password reset, invitations, member role updates, PostgreSQL RLS, published snapshot safety, and quoted CSV values.

## Still incomplete

- Full service modularization is in progress; the legacy `src/lib/services.ts` remains the central adapter for websites, CRM views/mutations, connectors, dashboards, and tenant default provisioning.
- Email delivery for auth links, CRM mutation depth, approval workflows, delayed workflows, and connector UI mapping are not complete.
- The worker is a durable batch dispatcher, but still needs a long-running polling loop, dead-letter UI, and domain-specific async handlers beyond the synchronous lead workflow.
