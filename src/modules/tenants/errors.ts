export type TenantErrorCode =
  | "tenant_not_found"
  | "tenant_owner_not_found"
  | "tenant_access_denied"
  | "invalid_invitation"
  | "invitation_account_exists"
  | "invitation_account_mismatch"
  | "member_exists"
  | "member_not_found"
  | "member_role_protected"
  | "member_role_forbidden";

export class TenantError extends Error {
  constructor(
    public readonly code: TenantErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TenantError";
  }
}
