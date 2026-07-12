# Night Shift Backlog

1. Continue webhook security completion: expand tenant-isolation/rate-limit edge tests, add delivery history visibility for operators, and confirm rejected delivery redaction across disabled/signature/rate-limit failures.
2. Continue workflow engine depth with more domain-specific async handlers and recovery views beyond dead-letter requeue and active queue cancellation.
3. Expand Playwright for draft edit while published site remains available.
4. Add real email delivery for password reset and invitation links.
5. Adopt `withTenantTransaction` across tenant service paths.
6. Investigate why local Node-based lint/typecheck/build sometimes hang even when CI is green.
7. Keep PR #1 updated as each coherent checkpoint lands.
