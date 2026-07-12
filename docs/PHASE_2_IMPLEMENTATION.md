# Phase 2 Implementation

## Implemented in this branch

- Added GitHub Actions CI with PostgreSQL 17 service, frozen pnpm install, migration verification, lint, typecheck, unit/integration tests, production build, and Playwright E2E.
- Added PostgreSQL/Drizzle foundation under `src/db/` with schema, client, migrations, tenant transaction helper, and repository guidance.
- Kept PGlite as a local fallback only when `DATABASE_URL` is absent outside production.
- Added Phase 2 migrations for hashed session tokens, published/draft website version pointers, domain events, rate limits, generation records, and encrypted connector secret versions.
- Added RLS migration draft with tenant context helpers and policies for key tenant-owned tables.
- Added PostgreSQL RLS integration coverage that runs with `DATABASE_URL` and verifies restricted-role tenant isolation plus cross-tenant write rejection.
- Added an additive RLS completion migration that protects every table carrying `tenant_id` plus `tenants`, limits system-access bypass to the database-owner role, and verifies catalog policy coverage and critical tenant families with a restricted PostgreSQL role.
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
- Extracted Business Twin onboarding into `src/modules/business-twin/` with schema validation, typed errors, tenant-scoped repository functions, transactional website generation/audit, and direct tenant-isolation coverage.
- Extracted tenant default provisioning into repository-backed tenant modules for pipelines/stages, the persisted lead workflow, connector defaults, and encrypted webhook secret setup, with two-tenant isolation coverage.
- Extracted audit reads and writes behind a tenant-scoped repository with bounded query validation, typed access errors, and direct cross-tenant coverage.
- Extracted dashboard composition into `src/modules/dashboard/` with bounded read options, tenant-scoped metric and pipeline-stage repositories, typed access errors, and populated-versus-empty tenant integration coverage.
- Extracted demo seeding into `src/modules/demo/` with bounded configuration, repository-backed existence checks, tenant/default provisioning reuse, idempotent public-lead creation, and repeat-run coverage.
- Added invitation creation, acceptance, pending invitation display, and member role updates for non-owner roles.
- Public demo seeding requires `FEATURE_PUBLIC_DEMO=true` in a non-production runtime and is rejected by both the public action and domain service in production; shared local credentials are documented as non-production only.
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
- Added active queue cancellation controls: pending/processing domain events can be tenant-authorized, skipped from Automatisations, removed from active processing, and audited.
- Added Connector SDK contracts, registry, robust CSV parsing, webhook HMAC verification for configured endpoint secrets, and AES-256-GCM credential encryption helpers.
- Hardened generic webhook delivery intake with required idempotency keys, duplicate accepted-delivery rejection, replay-window timestamp checks, request-size limits, endpoint rate limiting, redacted delivery payload logs, accepted/rejected outcome storage, and safe public route errors.
- Added tenant-scoped webhook endpoint controls in Connexions for status/signature visibility, HMAC secret rotation, disable/re-enable actions, server-side authorization, audit logging, and tenant-isolation coverage.
- Added secure webhook secrets by default: new tenant endpoints receive generated encrypted/hashed HMAC material, legacy null-secret endpoints are secured lazily before use, unsigned deliveries are rejected, and Connexions exposes generated one-time reveal rotation.
- Added disabled webhook rejected-delivery recording, safe public 403 status mapping, and regression coverage for old-secret rejection after HMAC rotation.
- Extracted connector catalog, connector state reads, CSV imports, mock sync, webhook receipt, import row persistence, and webhook delivery logging into `src/modules/connectors/`.
- Added AI provider abstraction with deterministic provider and optional OpenAI provider wrapper.
- Changed public website rendering to load the last immutable published snapshot.
- Added explicit public form idempotency keys, honeypot field, and visible consent checkbox.
- Added reusable atomic rate limiting with hashed subject and tenant scope keys, deterministic test support, bounded cleanup, retry metadata, and policies for auth, invitations, public forms, demo seeding, and inbound webhooks.
- Added bounded password-reset and invitation email delivery with French templates, APP_URL links, safe console/test providers, retryable outcomes, no raw-token response/log persistence, invitation delivery state, and authorized token-replacing resend.
- Added request correlation IDs, typed safe public errors, structured redacted logs, protected sensitive actions, safe webhook/health responses, Retry-After metadata, no-store token pages, and hardened CSP/security headers.
- Added production-only HSTS and DNS-rebinding-resistant outbound workflow webhooks that reject mixed/private resolutions and connect to a validated pinned address while preserving TLS hostname verification.
- Added centralized Zod environment validation at Next.js, worker, and database startup boundaries. Production requires PostgreSQL, a secure public URL, and a non-placeholder connector encryption key; malformed feature flags, numeric settings, database schemes, and AI configuration fail with value-safe errors.
- Added bounded session/token/invitation/rate-limit/idempotency maintenance with explicit retention, a one-shot command, a worker-compatible handler, structured output, and tests preserving audit/delivery history.
- Added injected-client-aware tenant transactions with transaction-local PostgreSQL context and rollback coverage for tenant/default provisioning, onboarding/Business Twin/site generation, website publication/restoration, invitation acceptance, public lead and accepted webhook CRM/form/audit/domain-event writes, and CSV finalization.
- Added atomic workflow operator controls for run cancellation, approval, rejection, manual retry, dead-letter retry, and queue cancellation, including state, timeline/resume, and audit rollback coverage.
- Added tests for session revocation, password reset, invitations, member role updates, PostgreSQL RLS, published snapshot safety, and quoted CSV values.

## Known production limitations

- `src/lib/services.ts` remains a compatibility composition facade; a static regression test rejects direct business SQL there.
- Email delivery has safe console/test providers and retryable production-unavailable behavior, but no external production provider is configured.
- Email, SMS, WhatsApp workflow actions and business connector sync remain explicitly mock/deterministic; they are not claimed as external production delivery.
- OpenAI is optional behind an abstraction; deterministic generation remains the default and no real provider call is required for Phase 2.
- Upload/storage interfaces are not implemented, so no production upload claim is made.
- RLS deployment requires a non-owner runtime database role and a separate privileged migration role.
