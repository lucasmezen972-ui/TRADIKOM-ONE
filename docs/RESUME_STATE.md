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
- Invitations can be created, accepted once, listed as pending, and used for non-owner role administration.
- PostgreSQL RLS integration test added for restricted-role tenant isolation and cross-tenant write rejection.
- Public-site hero images now use `next/image` with `images.unsplash.com` explicitly allowlisted.
- Tests added for session revocation, password reset, invitations, member role updates, PostgreSQL RLS, published snapshot safety, and quoted CSV parsing.

Latest local validation:

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e` passed after the auth flow batch.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e` passed after adding the RLS test; locally the RLS test is skipped unless `DATABASE_URL` is present.
- GitHub Actions passed on PR #1 for commit `bb367bf`, including the PostgreSQL RLS test with `DATABASE_URL`.
- GitHub Actions passed on PR #1 for commit `093080f`, including lint, typecheck, PostgreSQL tests, production build, and Playwright E2E. The previous public-site `<img>` lint warning is gone.

Current validation note:

- On the 2026-07-11 06:48 UTC heartbeat, full and targeted Node-based validation commands (`pnpm lint`, `pnpm typecheck`, `pnpm build`, direct ESLint, direct tsc) repeatedly hung and were stopped with a 60s guard.
- On the 2026-07-11 07:48 UTC heartbeat, PR #1 was still green at `bb367bf`; local `next/image` cleanup validation was retried. `next/image` eventually imported successfully, `git diff --check` passed, but ESLint import and `pnpm typecheck` still hung, so the draft was left uncommitted.
- On the 2026-07-11 08:48 UTC heartbeat, local validation still hung, but manual diff inspection and `git diff --check` passed. The cleanup was committed and pushed so GitHub Actions can run the full validation in the stable CI environment.
- Local Node-based validation remained unreliable during this heartbeat; prefer GitHub Actions for confirmation until local filesystem/tooling responsiveness improves.

Next unfinished task:

1. Commit and push this resume-state update.
2. Continue converting `src/lib/services.ts` into bounded modules, or make the workflow worker process pending events durably.
3. If local Node validation still hangs, keep using GitHub Actions as the authoritative validation path for small, reviewed changes.
