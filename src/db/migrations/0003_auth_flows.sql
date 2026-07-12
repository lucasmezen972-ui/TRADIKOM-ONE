-- Auth hardening for password reset and invitation links.

create unique index if not exists idx_password_reset_tokens_token_hash on password_reset_tokens(token_hash);
create index if not exists idx_password_reset_tokens_user on password_reset_tokens(user_id);

create unique index if not exists idx_invitations_token_hash on invitations(token_hash);
create index if not exists idx_invitations_tenant_email_status on invitations(tenant_id, email, status);
