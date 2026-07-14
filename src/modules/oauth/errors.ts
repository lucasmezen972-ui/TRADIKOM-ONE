export type OAuthErrorCode =
  | "oauth_state_invalid"
  | "oauth_state_expired"
  | "oauth_state_replayed"
  | "oauth_redirect_mismatch"
  | "oauth_code_invalid"
  | "oauth_scope_invalid"
  | "oauth_connection_not_found"
  | "oauth_credential_not_found"
  | "oauth_refresh_in_progress"
  | "oauth_credential_revoked"
  | "oauth_configuration_invalid";

export class OAuthError extends Error {
  constructor(
    public readonly code: OAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}
