# Night Shift Backlog

1. Extract public lead ingestion from `src/lib/services.ts`.
2. Extract website draft/publication responsibilities from `src/lib/services.ts`.
3. Add domain-specific async workflow handlers beyond the synchronous lead workflow.
4. Add CRM contact/task/opportunity mutations and audit tests.
5. Expand Playwright for draft edit while published site remains available.
6. Add real email delivery for password reset and invitation links.
7. Adopt `withTenantTransaction` across tenant service paths.
8. Add endpoint secret rotation UI.
9. Investigate why local Node-based lint/typecheck/build sometimes hang even when CI is green.
10. Keep PR #1 updated as each coherent checkpoint lands.
