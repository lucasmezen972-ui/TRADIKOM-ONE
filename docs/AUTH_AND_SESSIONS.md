# Auth And Sessions

Phase 2 changes sessions from raw database session IDs to bearer-style session tokens.

- Cookie stores the raw session token.
- Database stores only `token_hash`.
- `getSessionUser` hashes the cookie token before lookup.
- Logout calls `revokeSession` and sets `revoked_at`.
- Session expiry is still enforced by `expires_at`.
- Public demo is hidden in production unless `FEATURE_PUBLIC_DEMO=true`.

Remaining work:

- password reset request/complete UI;
- invitation acceptance UI;
- login and registration rate limiting;
- full role administration screens;
- scheduled cleanup of expired sessions.
