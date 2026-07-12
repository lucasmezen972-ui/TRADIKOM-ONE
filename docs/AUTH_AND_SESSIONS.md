# Auth And Sessions

Phase 2 changes sessions from raw database session IDs to bearer-style session tokens.

- Cookie stores the raw session token.
- Database stores only `token_hash`.
- `getSessionUser` hashes the cookie token before lookup.
- Logout calls `revokeSession` and sets `revoked_at`.
- Session expiry is still enforced by `expires_at`.
- Public demo is hidden in production unless `FEATURE_PUBLIC_DEMO=true`.
- Password reset requests return the same public response for known and unknown accounts, store only `token_hash` for existing accounts, expire after one hour, invalidate older unused tokens, and send the raw link only through the selected email provider.
- Password reset completion updates the password, marks all outstanding reset tokens used, and revokes active sessions for the account.
- Invitations store only a hashed invitation token, expire after seven days, and can be accepted once.
- Invitations are emailed through the bounded provider, persist safe delivery status, and authorized resend replaces the previous token before delivery.
- Owners and administrators can invite team members. Only owners can invite or manage administrators.
- Registration, login, password reset, invitation creation, and invitation acceptance use atomic server-side rate limits with hashed subject/scope keys.

Remaining work:

- scheduled cleanup of expired sessions.
