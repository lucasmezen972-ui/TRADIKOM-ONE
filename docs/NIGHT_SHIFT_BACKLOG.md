# Night Shift Backlog

1. Continue workflow engine depth: add more domain-specific async handlers beyond lead, connector sync, Radar sync, and notification dispatch, plus recovery actions beyond the current queue overview and dead-letter requeue control.
2. Expand Playwright for draft edit while published site remains available.
3. Add real email delivery for password reset and invitation links.
4. Adopt `withTenantTransaction` across tenant service paths.
5. Add endpoint secret rotation UI.
6. Investigate why local Node-based lint/typecheck/build sometimes hang even when CI is green.
7. Keep PR #1 updated as each coherent checkpoint lands.
