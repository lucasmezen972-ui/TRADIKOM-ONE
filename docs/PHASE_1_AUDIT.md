# Phase 1 Audit

Audit executed on branch `codex/phase-2-production-foundation` on 2026-07-11.

## Commands Executed

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | Pass | Completed in 319 ms with pnpm 11.7.0. |
| `pnpm lint` | Pass with warning | ESLint reported one non-blocking Next.js warning for `<img>` usage in `src/components/site-renderer.tsx`. |
| `pnpm typecheck` | Pass | `tsc --noEmit` completed successfully. |
| `pnpm test` | Pass | 3 test files, 3 tests passed. |
| `pnpm test:e2e` | Pass | 1 Playwright Chromium scenario passed. |
| `pnpm build` | Pass | Next.js 16.2.10 production build completed successfully. |

## Architecture Findings

- The product is a working Phase 1 proof of concept, not a production foundation.
- Runtime persistence is implemented in `src/lib/db.ts` with PGlite and SQL strings. There is no production PostgreSQL client, typed schema, or migration runner.
- `src/lib/services.ts` is a monolith of 1,794 lines and owns authentication, tenants, onboarding, website generation, CRM, workflows, connectors, audit logs, seeding, and mapping.
- Server actions in `src/app/actions.ts` are relatively thin, but they depend on the monolithic service rather than bounded modules.
- The app has no `.github/workflows` CI.
- There is no separate worker entry point, queue, transactional outbox, or durable retry system.
- Documentation already states several future directions, but some docs describe target architecture rather than runtime behavior.

## Security Findings

- Sessions are stored as raw opaque IDs in the database and cookies. Session tokens are not hashed at rest.
- Logout clears the browser cookie but does not revoke the database session.
- Login and registration do not have rate limiting.
- Password reset and invitations have tables but no complete user flows.
- Tenant authorization is enforced in application services, but PostgreSQL RLS is only a draft SQL file and not the runtime protection layer.
- Public forms and webhooks lack size limits, replay protection, HMAC verification, structured safe errors, and durable idempotency keys.
- The public demo action is visible without an environment gate.
- Connector credentials are modeled but not encrypted.

## Product Gaps

- CRM screens are mostly read-only.
- Contacts, tasks, opportunities, notes, and pipeline stages need actionable mutation flows.
- Workflow execution is special-cased for website leads rather than definition-driven.
- Connectors are metadata plus service functions, not SDK implementations.
- Website templates differ mostly by theme inputs; there is no real multi-page public site foundation.
- Editing draft sections updates mutable rows used by the editor; publication snapshots exist, but the public site still renders mutable current rows instead of immutable published content.
- AI generation is deterministic only; there is no provider abstraction, generation log, approval state, or optional OpenAI adapter.

## Data-Model Gaps

- Tenant-owned tables exist, but RLS policies are incomplete and not tied to runtime transaction context.
- Critical multi-step writes are not consistently transactional.
- Form idempotency is derived from submitted content and date, which can incorrectly collapse legitimate repeated submissions.
- Workflow runs, steps, approvals, connector syncs, imports, and audit logs exist, but they are not connected to a durable event/outbox model.
- Published website records exist, but the read path does not yet enforce immutable published snapshots.

## Tests That Give False Confidence

- Unit and integration coverage is only 3 test files and 3 tests.
- E2E coverage is one happy-path demo scenario using shared demo data.
- There are no runtime PostgreSQL tests, no RLS tests, no role matrix tests, no rate-limit tests, no password reset tests, no invitation tests, no workflow retry tests, and no draft/published separation tests.
- Existing connector tests cover only a simple CSV string and basic webhook payload, not signatures, replay rejection, quoted CSV, dry runs, duplicate resolution, or credential encryption.

## Migration Plan

1. Add CI to run install, lint, typecheck, tests, E2E, build, and migration checks.
2. Introduce a typed PostgreSQL database layer with explicit migrations while retaining PGlite only for local fallback if useful.
3. Add tenant-scoped transaction helpers and complete RLS policies for tenant-owned tables.
4. Harden sessions by storing hashed tokens, revoking sessions on logout, and gating the public demo by environment.
5. Split the monolithic service into bounded modules.
6. Add transactional outbox, worker command, workflow definition registry, action registry, retries, delays, approvals, and idempotency.
7. Convert connectors into SDK implementations with secure webhook verification, robust CSV parsing, mock sync idempotency, and encrypted credentials.
8. Make public site rendering read immutable published snapshots and expand the website model toward multi-page publication.
9. Add AI provider abstraction with deterministic fallback and test fake provider.
10. Expand CRM mutation flows and Opportunity Radar rules.
11. Expand tests to cover security, RLS, roles, workflows, connectors, publication safety, and public endpoint abuse controls.
