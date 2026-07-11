# Resume State

Branch: `codex/phase-2-production-foundation`

Last completed checkpoint:

- Baseline audit created and committed in `docs/PHASE_1_AUDIT.md`.
- PostgreSQL/Drizzle foundation added.
- CI workflow added.
- Hashed/revocable sessions implemented.
- Public demo gated by environment.
- Workflow engine foundation added and lead follow-up routed through it.
- Connector SDK, CSV parser, credential encryption, and AI provider abstraction added.
- Public site now renders immutable published snapshots.
- Public form now has explicit idempotency, honeypot, and consent.
- Password reset request/complete flows use hashed single-use tokens and revoke sessions after reset.
- Authentication and sessions are extracted into `src/modules/auth/` with schemas, typed errors, repository functions, and a domain service.
- Tenant access, tenant creation, team invitations, member role management, and audit recording are extracted into bounded tenant/audit modules.
- Public website lead ingestion is extracted into `src/modules/crm/` with schemas, typed errors, repository functions, idempotent form submission handling, contact/lead/opportunity creation, audit events, and workflow dispatch preserved.
- CRM read models, recent activity reads, and tenant-scoped contact lookup are extracted into `src/modules/crm/` with tenant authorization preserved.
- CRM contact detail, contact profile updates, consent updates, notes, contact tasks, task completion, contact-linked opportunities, and interaction timeline reads now live in `src/modules/crm/` with tenant authorization, assignment validation, audit events, server actions, UI, and integration coverage.
- CRM opportunity listing, search/filter support, opportunity detail, stage/value/next-action/lost-reason updates, pipeline-stage tenant validation, audit events, contact timeline propagation, UI, and integration coverage are implemented in `src/modules/crm/`.
- CRM duplicate detection and transactional merge are implemented in `src/modules/crm/` with normalized email/phone/name/company matching, review UI, field-level merge choices, tombstone merge records, audit events, reassignment of related CRM/workflow references, and integration coverage.
- Opportunity Radar is extracted under `src/modules/opportunity-radar/` with typed alert records, persisted status, direct action links, duplicate-contact alert integration, dismissal, automatic resolution, dashboard wiring, dedicated UI, and integration coverage.
- Website draft, publication, rollback, immutable public snapshot, and workspace reads are extracted into `src/modules/websites/` with schemas, typed errors, repository functions, tenant authorization, and audit events preserved.
- Connector catalog, connector state reads, CSV imports, mock sync, webhook receipt, import rows, and webhook delivery logging are extracted into `src/modules/connectors/` with schemas, typed errors, repository functions, tenant authorization, audit events, and direct module coverage.
- Invitations can be created, accepted once, listed as pending, and used for non-owner role administration.
- PostgreSQL RLS integration test added for restricted-role tenant isolation and cross-tenant write rejection.
- Public-site hero images now use `next/image` with `images.unsplash.com` explicitly allowlisted.
- Workflow worker now processes due `domain_events` batches durably with processing claims, retry backoff, stale processing requeue, terminal failures, and targeted unit coverage.
- Lead follow-up now loads the active tenant workflow definition from persistence and executes it through `src/modules/workflows/` repository helpers and action registry rather than a hidden hard-coded action path. The checkpoint includes normalized versioned definitions, condition checks, event replay idempotency, timeline step metadata, approval-required stops, waiting-state support, and registered initial actions for task/contact/tag/activity/mock notification/webhook/wait/approval behavior.
- Workflow run controls are implemented in `src/modules/workflows/` with tenant-authorized cancel, approve, reject, and manual retry services; server actions; Automatisations UI controls; control timeline entries; audit logs; and integration coverage for tenant isolation and status transitions.
- Durable workflow resumption is implemented through `workflow.resume` domain events: wait actions schedule delayed resumes, approvals enqueue resumes after approval, manual retry replays the failed action, cancelled runs skip queued resumes, and focused tests cover wait, approval, cancellation, and retry behavior.
- Worker polling mode is implemented with `WORKER_MODE=once|poll`, configurable batch size and interval, structured JSON logs, heartbeat entries, graceful `SIGTERM`/`SIGINT` shutdown, clean database closing, and focused worker tests.
- Workflow dead-letter visibility is implemented: failed terminal `domain_events` are exposed in Automatisations through tenant-scoped workflow service reads with attempts, correlation IDs, timestamps, redacted error messages, and tenant-isolation coverage.
- Workflow step attempt metadata is persisted: `workflow_run_steps` now records attempt counts, scheduled/start/completion timestamps, safe error summaries, and tests assert completed action attempts.
- Workflow dead-letter manual recovery is implemented: authorized workflow operators can requeue failed terminal `domain_events` from Automatisations, reset attempts for a fresh worker retry window, clear safe errors, and audit the action.
- Domain event retry/backoff metadata is persisted: worker claims, retries, and terminal failures now record last attempted time, computed retry delay, failure classification, and max attempts.
- Generic webhook endpoints can now enforce encrypted HMAC secrets with timestamped signatures and rejection delivery logs.
- Tests added for session revocation, password reset, invitations, member role updates, PostgreSQL RLS, published snapshot safety, and quoted CSV parsing.

Latest local validation:

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e` passed after the auth flow batch.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e` passed after adding the RLS test; locally the RLS test is skipped unless `DATABASE_URL` is present.
- GitHub Actions passed on PR #1 for commit `bb367bf`, including the PostgreSQL RLS test with `DATABASE_URL`.
- GitHub Actions passed on PR #1 for commit `093080f`, including lint, typecheck, PostgreSQL tests, production build, and Playwright E2E. The previous public-site `<img>` lint warning is gone.
- GitHub Actions passed on PR #1 for commit `47906c3`, the resume-state update after the image cleanup.

Current validation note:

- On the 2026-07-11 06:48 UTC heartbeat, full and targeted Node-based validation commands (`pnpm lint`, `pnpm typecheck`, `pnpm build`, direct ESLint, direct tsc) repeatedly hung and were stopped with a 60s guard.
- On the 2026-07-11 07:48 UTC heartbeat, PR #1 was still green at `bb367bf`; local `next/image` cleanup validation was retried. `next/image` eventually imported successfully, `git diff --check` passed, but ESLint import and `pnpm typecheck` still hung, so the draft was left uncommitted.
- On the 2026-07-11 08:48 UTC heartbeat, local validation still hung, but manual diff inspection and `git diff --check` passed. The cleanup was committed and pushed so GitHub Actions can run the full validation in the stable CI environment.
- On the 2026-07-11 09:49 UTC heartbeat, targeted local worker validation (`pnpm exec vitest run tests/workflow-worker.test.ts`) hung and `git diff --check` exited abnormally without output, matching the known local Node/tooling instability. The worker change was manually inspected and should be validated through GitHub Actions after push.
- On the 2026-07-11 10:51 UTC heartbeat, targeted connector validation (`pnpm exec vitest run tests/connectors.test.ts`) hung after runner startup, while `git diff --check` passed. The HMAC webhook change should be validated through GitHub Actions after push.
- During the immediate 2026-07-11 continuation, targeted auth validation (`pnpm exec vitest run tests/auth-module.test.ts tests/auth-sessions.test.ts tests/auth-flows.test.ts`) hung without output and was stopped; `git diff --check` passed. The auth extraction should be validated through GitHub Actions after push.
- During the same continuation, targeted tenant validation (`pnpm exec vitest run tests/tenants-module.test.ts tests/auth-flows.test.ts`) hung and was stopped; `git diff --check` passed. The tenant/team extraction should be validated through GitHub Actions after push.
- During the same continuation, targeted public lead validation (`pnpm exec vitest run tests/public-leads-module.test.ts tests/vertical-slice.test.ts`) produced no output after a reasonable wait and was stopped; `git diff --check` should be run before push and the checkpoint validated through GitHub Actions.
- During the same continuation, targeted website validation (`pnpm exec vitest run tests/websites-module.test.ts tests/publication-snapshots.test.ts tests/vertical-slice.test.ts`) produced no output after a reasonable wait and was stopped. `git diff --check` also hung without output and was stopped.
- GitHub Actions passed on PR #1 for website extraction commit `033f062`, including migration verification, lint, typecheck, unit/integration tests, production build, and Playwright E2E.
- During the same continuation, targeted CRM read-model validation (`pnpm exec vitest run tests/crm-module.test.ts tests/tenant-isolation.test.ts tests/vertical-slice.test.ts`) hung without output and was stopped; `git diff --check` passed.
- GitHub Actions passed on PR #1 for CRM read-model extraction commit `70d8ff9`, including migration verification, lint, typecheck, unit/integration tests, production build, and Playwright E2E.
- During the same continuation, targeted connectors validation (`pnpm exec vitest run tests/connectors-module.test.ts tests/connectors.test.ts`) hung without output and was stopped; `git diff --check` passed.
- GitHub Actions passed on PR #1 for connectors extraction commit `a9a55cf`, including migration verification, lint, typecheck, unit/integration tests, production build, and Playwright E2E.
- During the 2026-07-11 12:13 UTC heartbeat, targeted CRM mutation validation (`pnpm exec vitest run tests/crm-mutations.test.ts tests/crm-module.test.ts`) hung without output and was stopped. `git diff --check` passed.
- GitHub Actions initially failed CRM mutation commit `ef4cb8c` on page lint, then passed on PR #1 for fix commit `5877e3f`, including migration verification, lint, typecheck, unit/integration tests, production build, and Playwright E2E.
- During the same heartbeat, targeted CRM opportunity validation (`pnpm exec vitest run tests/crm-opportunities.test.ts tests/crm-mutations.test.ts`) hung without output and was stopped. `git diff --check` also exited abnormally without output before staging, but `git diff --cached --check` passed after explicit staging.
- GitHub Actions passed on PR #1 for CRM opportunity mutation commit `0c892b2`, including migration verification, lint, typecheck, unit/integration tests, production build, and Playwright E2E.
- During the CRM duplicate merge checkpoint, targeted validation (`pnpm exec vitest run tests/crm-duplicates.test.ts`) hung without output and was stopped after 30 seconds. A one-off TypeScript check (`pnpm exec tsc --noEmit --pretty false --incremental false`) also hung without output and was stopped after 30 seconds. `GIT_PAGER=cat git diff --check` passed.
- GitHub Actions initially failed duplicate tests on commit `1afba97` because `DATABASE_URL` made the CRM merge transaction helper choose PostgreSQL even when the injected test database was PGlite. The fix marks real PostgreSQL SQL clients and only uses `withTenantTransaction` for those clients.
- GitHub Actions passed on PR #1 for CRM duplicate merge fix commit `aa098ff`, including migration verification, lint, typecheck, unit/integration tests, production build, and Playwright E2E.
- During the Opportunity Radar extraction checkpoint, targeted validation (`pnpm exec vitest run tests/opportunity-radar.test.ts`) and local `git diff --check` both hung without output and were stopped. Validate the checkpoint through GitHub Actions after push.
- GitHub Actions passed on PR #1 for Opportunity Radar extraction commit `fe98f56`, including migration verification, lint, typecheck, unit/integration tests, production build, and Playwright E2E.
- During the persisted workflow engine checkpoint, targeted local validation (`pnpm exec vitest run tests/workflow-engine.test.ts`), a one-off TypeScript check, and a simple `tsx` startup all hung without output and were stopped. Targeted `git diff --check` and `git diff --cached --check` passed.
- GitHub Actions passed on PR #1 for workflow engine checkpoint commit `46a0164`, including migration verification, lint, typecheck, unit/integration tests, production build, and Playwright E2E.
- During the workflow run controls checkpoint, targeted local validation was skipped because local Node tooling remained unreliable; files were manually inspected and staged explicitly.
- GitHub Actions passed on PR #1 for workflow controls commit `73cef7b`, including migration verification, lint, typecheck, unit/integration tests, production build, and Playwright E2E.
- During the durable workflow resumption checkpoint, targeted local workflow-resume Vitest and one-off TypeScript checks hung without output and were stopped. `git diff --check` returned clean for tracked changes before the checkpoint was pushed.
- GitHub Actions initially failed commit `ba42a11` because the older workflow-controls test seeded an approval run without a timeline cursor; commit `a27045a` preserves that legacy control behavior while still enqueueing resumes for real approval action timelines.
- GitHub Actions passed on PR #1 for durable workflow resumption fix commit `a27045a`, including migration verification, lint, typecheck, unit/integration tests, production build, and Playwright E2E.
- Local Node-based validation remained unreliable during this heartbeat; prefer GitHub Actions for confirmation until local filesystem/tooling responsiveness improves.
- During the worker polling checkpoint, targeted local validation (`pnpm exec vitest run tests/workflow-worker.test.ts`) hung without output and was stopped after 30 seconds. `git diff --check` and `git diff --stat` also hung without output and were stopped, so this checkpoint should be validated through GitHub Actions after push.
- GitHub Actions passed on PR #1 for worker polling commit `64c9bf3`, including migration verification, lint, typecheck, unit/integration tests, production build, and Playwright E2E.
- During the workflow dead-letter checkpoint, targeted local validation (`pnpm exec vitest run tests/workflow-worker.test.ts`) hung without output and was stopped after 30 seconds. `git diff --check` hung without output before staging, while `git diff --cached --check` passed after explicit staging.
- GitHub Actions passed on PR #1 for workflow dead-letter commit `75d5740`, including migration verification, lint, typecheck, unit/integration tests, production build, and Playwright E2E.
- During the workflow step-attempt checkpoint, targeted local validation (`pnpm exec vitest run tests/workflow-engine.test.ts`) hung without output and was stopped after 30 seconds. Validate this checkpoint through GitHub Actions after push.
- GitHub Actions passed on PR #1 for workflow step-attempt commit `a510be2`, including migration verification, lint, typecheck, unit/integration tests, production build, and Playwright E2E.
- During the workflow dead-letter recovery checkpoint, targeted local validation (`pnpm exec vitest run tests/workflow-worker.test.ts`) hung without output and was stopped after 30 seconds. `git diff --check` passed, so validate this checkpoint through GitHub Actions after push.
- During the workflow retry metadata checkpoint, targeted local validation should be attempted with the same 30 second guard and then validated through GitHub Actions if local Node tooling still hangs.

Next unfinished task:

1. Continue Phase 2 workflow engine depth: domain-specific async handlers beyond the lead follow-up path and deeper operational recovery views beyond the current dead-letter requeue control.
2. If local Node validation still hangs, keep using GitHub Actions as the authoritative validation path for small, reviewed changes.
3. Keep PR #1 updated with coherent checkpoints and confirm CI after each push.
