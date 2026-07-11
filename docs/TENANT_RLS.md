# Tenant RLS

PostgreSQL is now the primary runtime when `DATABASE_URL` is configured. PGlite remains a local fallback.

The tenant transaction helper is `withTenantTransaction(tenantId, actorId, callback)` in `src/db/tenant-context.ts`.

It starts a transaction, sets transaction-local `app.tenant_id` and `app.actor_id`, executes the callback, then commits or rolls back.

RLS migration `src/db/migrations/0002_rls.sql` defines:

- `app_current_tenant_id()`;
- `app_is_system()`;
- RLS enablement for tenant-owned tables;
- `USING` and `WITH CHECK` policies for covered tables.

`tests/postgres-rls.test.ts` runs when `DATABASE_URL` is present. It creates a temporary non-owner PostgreSQL role, grants limited table access, verifies that no tenant context returns no tenant rows, verifies that `app.tenant_id` exposes only the matching tenant rows, and verifies that cross-tenant inserts are rejected by `WITH CHECK`.

Important limitation: the current application still has legacy service paths that do not always call `withTenantTransaction`. The current RLS test proves the database policy boundary, while service-by-service transaction adoption remains a follow-up.
