# Night Shift Log

## 2026-07-11

- Read Phase 2 prompt and created branch `codex/phase-2-production-foundation`.
- Ran baseline commands and recorded results in `docs/PHASE_1_AUDIT.md`.
- Added GitHub Actions CI.
- Added PostgreSQL/Drizzle foundation and migrations.
- Implemented hashed session tokens and logout revocation.
- Added workflow, connector, and AI foundations.
- Fixed public publication to read immutable snapshots.
- Added public form idempotency, honeypot, and consent.
- Expanded tests from 3 to 6 tests.
- Confirmed PR #1 CI was green for the Phase 2 foundation checkpoint.
- Added password reset request/complete flows with hashed single-use tokens and session revocation.
- Added invitation creation, one-time acceptance, pending invitation display, and non-owner member role updates.
- Expanded tests from 6 to 10 tests.
- Added a PostgreSQL-only RLS integration test with a temporary restricted role.
- Confirmed CI green for commit `bb367bf`, including PostgreSQL RLS coverage.
- Started a small `next/image` cleanup for the remaining public-site `<img>` warning, but left it uncommitted because local Node-based validation commands hung repeatedly.
- Retried the `next/image` cleanup validation one hour later; `next/image` import and `git diff --check` passed, but ESLint import and `pnpm typecheck` still hung, so nothing was committed or pushed.
- Retried again; local Node validation still hung, but manual diff inspection and `git diff --check` passed, so the cleanup was prepared for CI validation on PR #1.
- Pushed the `next/image` cleanup as commit `093080f`; GitHub Actions passed and the previous `<img>` lint warning disappeared.
- Added durable batch processing for `domain_events`: processing claims, retry backoff, stale processing requeue, terminal failures, and targeted worker tests.
- Targeted local worker validation hung and `git diff --check` exited abnormally without output, so the worker checkpoint should be confirmed through GitHub Actions.
- Wired generic webhook HMAC verification to encrypted endpoint secrets with timestamp/signature headers and rejection delivery logs.
- Targeted local connector validation hung after runner startup, while `git diff --check` passed, so the HMAC checkpoint should be confirmed through GitHub Actions.
- Extracted authentication and session logic into `src/modules/auth/` with schemas, typed errors, repository functions, a domain service, and a direct module test.
- Targeted local auth validation hung without output and was stopped; `git diff --check` passed, so the auth extraction should be confirmed through GitHub Actions.
- Extracted tenant access, tenant creation, team invitations, member role management, and audit recording into `src/modules/tenants/` and `src/modules/audit/`, with a direct module test.
- Targeted local tenant validation hung and was stopped; `git diff --check` passed, so the tenant/team extraction should be confirmed through GitHub Actions.
- Extracted public website lead ingestion into `src/modules/crm/` with repository functions, schemas, typed errors, idempotent public form handling, audit preservation, and a direct idempotency test.
- Targeted local public lead validation hung without output and was stopped; continue to use `git diff --check` plus GitHub Actions for this checkpoint.
- Extracted website draft/publication responsibilities into `src/modules/websites/`, including workspace reads, draft edits, section reordering, publish, restore, immutable public snapshot reads, repository functions, schemas, typed errors, and a direct module test.
- Targeted local website validation and `git diff --check` both hung without output and were stopped; this checkpoint should be validated by GitHub Actions.
