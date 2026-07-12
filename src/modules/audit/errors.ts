export type AuditErrorCode = "audit_access_denied";

export class AuditError extends Error {
  constructor(
    public readonly code: AuditErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuditError";
  }
}
