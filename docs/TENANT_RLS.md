# Tenant RLS

PostgreSQL is now the primary runtime when `DATABASE_URL` is configured. PGlite remains a local fallback.

The tenant transaction helper is `withTenantTransaction(tenantId, actorId, callback)` in `src/db/tenant-context.ts`.

It starts a transaction, sets transaction-local `app.tenant_id` and `app.actor_id`, executes the callback, then commits or rolls back.

Les migrations `src/db/migrations/0002_rls.sql` et `0009_rls_policy_completion.sql` definissent :

- `app_current_tenant_id()`;
- `app_is_system()`;
- RLS pour toutes les tables portant `tenant_id` et pour `tenants`;
- une policy `ALL` avec `USING` et `WITH CHECK`;
- un acces systeme limite au role proprietaire, meme si un role restreint tente de positionner `app.system_access`.

`tests/postgres-rls.test.ts` s'execute en CI avec `DATABASE_URL`. Il cree un role temporaire non proprietaire, controle la couverture du catalogue, verifie plusieurs familles critiques, refuse les lectures/ecritures inter-tenant et prouve que le drapeau systeme ne permet pas une auto-elevation.

Exigence de deploiement : le runtime web/worker doit utiliser un role non proprietaire. Les migrations doivent etre executees separement avec un role privilegie; utiliser le proprietaire des tables comme role applicatif annulerait la defense RLS native de PostgreSQL.
