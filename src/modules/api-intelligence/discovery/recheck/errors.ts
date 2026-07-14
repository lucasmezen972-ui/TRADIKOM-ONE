export type ApiSourceRecheckErrorCode =
  | "source_not_found"
  | "source_not_official"
  | "domain_not_approved";

export class ApiSourceRecheckError extends Error {
  constructor(
    public readonly code: ApiSourceRecheckErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiSourceRecheckError";
  }
}
