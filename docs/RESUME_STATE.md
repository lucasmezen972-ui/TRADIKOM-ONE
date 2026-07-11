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
- Tests added for session revocation, published snapshot safety, and quoted CSV parsing.

Latest local validation:

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passed with one non-blocking Next.js `<img>` warning.
- `pnpm test:e2e` passed after updating the selector for accented French copy and consent checkbox.

Next unfinished task:

1. Run full validation again after documentation updates.
2. Commit the Phase 2 foundation batch.
3. Continue with password reset and invitations, or deepen PostgreSQL RLS tests with a restricted DB role.
4. Push branch and open/update draft PR when a coherent checkpoint is ready.
