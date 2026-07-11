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
- Website draft, publication, rollback, immutable public snapshot, and workspace reads are extracted into `src/modules/websites/` with schemas, typed errors, repository functions, tenant authorization, and audit events preserved.
- Invitations can be created, accepted once, listed as pending, and used for non-owner role administration.
- PostgreSQL RLS integration test added for restricted-role tenant isolation and cross-tenant write rejection.
- Public-site hero images now use `next/image` with `images.unsplash.com` explicitly allowlisted.
- Workflow worker now processes due `domain_events` batches durably with processing claims, retry backoff, stale processing requeue, terminal failures, and targeted unit coverage.
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
- During the same continuation, targeted website validation (`pnpm exec vitest run tests/websites-module.test.ts tests/publication-snapshots.test.ts tests/vertical-slice.test.ts`) produced no output after a reasonable wait and was stopped. `git diff --check` also hung without output and was stopped, so this checkpoint should be validated through GitHub Actions after manual inspection and push.
- Local Node-based validation remained unreliable during this heartbeat; prefer GitHub Actions for confirmation until local filesystem/tooling responsiveness improves.

Next unfinished task:

1. Continue extracting bounded modules from `src/lib/services.ts`, starting with deeper CRM views/mutations or connectors after the website checkpoint is green.
2. If local Node validation still hangs, keep using GitHub Actions as the authoritative validation path for small, reviewed changes.
3. Keep PR #1 updated with coherent checkpoints and confirm CI after each push.
