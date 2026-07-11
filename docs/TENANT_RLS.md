# Tenant RLS

PostgreSQL is now the primary runtime when `DATABASE_URL` is configured. PGlite remains a local fallback.

The tenant transaction helper is `withTenantTransaction(tenantId, actorId, callback)` in `src/db/tenant-context.ts`.

It starts a transaction, sets transaction-local `app.tenant_id` and `app.actor_id`, executes the callback, then commits or rolls back.

RLS migration `src/db/migrations/0002_rls.sql` defines:

- `app_current_tenant_id()`;
- `app_is_system()`;
- RLS enablement for tenant-owned tables;
- `USING` and `WITH CHECK` policies for covered tables.

Important limitation: the current application still has legacy service paths that do not always call `withTenantTransaction`. RLS tests with a restricted non-owner DB role remain a Phase 2 follow-up.
