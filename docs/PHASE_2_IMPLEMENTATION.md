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
- Extracted CRM read models, recent activity reads, and tenant-scoped contact lookup into `src/modules/crm/`.
- Added CRM contact detail and mutation depth in `src/modules/crm/`: contact updates, assignment validation, consent status, notes, task creation/completion, contact-linked opportunities, timeline reads, server actions, contact detail UI, and tenant-isolation/audit coverage.
- Added CRM opportunity depth in `src/modules/crm/`: opportunity listing with search/filter support, detail UI, stage/value/next-action/lost-reason updates, pipeline-stage tenant validation, contact timeline propagation, audit events, and integration coverage.
- Added CRM duplicate handling in `src/modules/crm/`: normalized candidate detection, manual review UI, side-by-side comparison, survivor selection, field-level merge choices, explicit confirmation, merge tombstone records, audit logging, transaction-backed reassignment of related records, and integration coverage.
- Extracted Opportunity Radar into `src/modules/opportunity-radar/` with typed persisted alerts, deterministic sync, direct action links, duplicate-contact alerts, dismissal, automatic resolution, dashboard wiring, dedicated UI, and integration coverage.
- Extracted website draft/publication responsibilities into `src/modules/websites/` with repository functions, schemas, typed errors, tenant authorization, audit preservation, immutable public snapshot reads, and rollback support.
- Added invitation creation, acceptance, pending invitation display, and member role updates for non-owner roles.
- Gated public demo outside local development unless `FEATURE_PUBLIC_DEMO=true`.
- Introduced workflow definition schema, domain event enqueueing, a workflow action executor, and a worker entry point with durable batch processing, retries, and stale processing requeue.
- Switched lead follow-up behavior to the workflow engine rather than inline special-case task creation.
- Added workflow run controls for cancellation, approval, rejection, and manual retry with tenant authorization, audit logs, timeline entries, server actions, UI controls, and integration coverage.
- Added durable workflow resumption through internal `workflow.resume` domain events for waits, approvals, manual retries, and cancelled-run skip behavior.
- Added worker polling mode with `WORKER_MODE=once|poll`, configurable batch size and polling interval, heartbeat logs, structured JSON output, graceful `SIGTERM`/`SIGINT` shutdown, and database cleanup.
- Added tenant-scoped workflow dead-letter visibility in Automatisations for failed terminal `domain_events`, with attempts, correlation IDs, timestamps, redacted error messages, and tenant-isolation coverage.
- Added persisted workflow step attempt metadata: action rows now include attempt counts, scheduled/start/completion timestamps, safe error summaries, a runtime migration, schema coverage, and focused workflow-engine assertions.
- Added manual dead-letter recovery controls: failed terminal domain events can be requeued from Automatisations by authorized workflow operators with tenant isolation, audit logging, and a fresh worker retry window.
- Added domain event retry/backoff metadata: worker attempts now persist last attempted time, computed retry delay, failure classification, and max attempts, and Automatisations surfaces safe failure labels for failed incidents.
- Added the first domain-specific async worker handler beyond workflow resume: `connector.sync_requested` dispatches the mock connector sync through the durable outbox path with connector state updates, sync/activity rows, and audit logging.
- Added Connector SDK contracts, registry, robust CSV parsing, webhook HMAC verification for configured endpoint secrets, and AES-256-GCM credential encryption helpers.
- Extracted connector catalog, connector state reads, CSV imports, mock sync, webhook receipt, import row persistence, and webhook delivery logging into `src/modules/connectors/`.
- Added AI provider abstraction with deterministic provider and optional OpenAI provider wrapper.
- Changed public website rendering to load the last immutable published snapshot.
- Added explicit public form idempotency keys, honeypot field, and visible consent checkbox.
- Added tests for session revocation, password reset, invitations, member role updates, PostgreSQL RLS, published snapshot safety, and quoted CSV values.

## Still incomplete

- Full service modularization is in progress; the legacy `src/lib/services.ts` remains the central adapter for dashboards and tenant default provisioning.
- Email delivery for auth links and connector UI mapping are not complete.
- The worker is now available as both a durable batch dispatcher and a polling process, but still needs additional domain-specific async handlers beyond the lead workflow and deeper recovery views beyond the current dead-letter requeue control.
