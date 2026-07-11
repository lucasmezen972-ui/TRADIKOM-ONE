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
- Tests added for session revocation, password reset, invitations, member role updates, PostgreSQL RLS, published snapshot safety, and quoted CSV parsing.

Latest local validation:

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e` passed after the auth flow batch.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e` passed after adding the RLS test; locally the RLS test is skipped unless `DATABASE_URL` is present.
- `pnpm lint` still has one non-blocking Next.js `<img>` warning in `src/components/site-renderer.tsx`.

Next unfinished task:

1. Commit and push the RLS test batch.
2. Confirm GitHub Actions on PR #1 after push, because the RLS test runs there with PostgreSQL.
3. Continue converting `src/lib/services.ts` into bounded modules, or make the workflow worker process pending events durably.
