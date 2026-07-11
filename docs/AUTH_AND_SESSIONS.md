# Auth And Sessions

Phase 2 changes sessions from raw database session IDs to bearer-style session tokens.

- Cookie stores the raw session token.
- Database stores only `token_hash`.
- `getSessionUser` hashes the cookie token before lookup.
- Logout calls `revokeSession` and sets `revoked_at`.
- Session expiry is still enforced by `expires_at`.
- Public demo is hidden in production unless `FEATURE_PUBLIC_DEMO=true`.
- Password reset requests return a one-time raw token to the server caller, store only `token_hash`, expire after one hour, and invalidate older unused reset tokens for the same user.
- Password reset completion updates the password, marks all outstanding reset tokens used, and revokes active sessions for the account.
- Invitations store only a hashed invitation token, expire after seven days, and can be accepted once.
- Owners and administrators can invite team members. Only owners can invite or manage administrators.

Remaining work:

- login and registration rate limiting;
- email delivery provider for reset and invitation links;
- scheduled cleanup of expired sessions.
