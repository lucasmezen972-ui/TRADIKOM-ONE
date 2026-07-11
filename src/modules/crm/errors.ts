export type CrmErrorCode =
  | "published_site_not_found"
  | "invalid_lead_payload"
  | "contact_not_found";

export class CrmError extends Error {
  constructor(
    public readonly code: CrmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CrmError";
  }
}
