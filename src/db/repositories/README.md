# Repositories

Phase 2 introduces explicit repository boundaries. The legacy Phase 1 service
still delegates many reads and writes during the transition, but new code should
live in bounded domain repositories instead of expanding `src/lib/services.ts`.

Repository rules:

- accept a `SqlClient` scoped by `withTenantTransaction` where tenant data is involved;
- never read or write tenant data without `tenant_id`;
- keep route handlers and server actions thin;
- return domain objects, not raw database driver results;
- avoid leaking database errors directly to UI code.
