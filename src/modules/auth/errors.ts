export type AuthErrorCode =
  | "account_exists"
  | "invalid_credentials"
  | "invalid_reset_token";

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}
