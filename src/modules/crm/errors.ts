export type CrmErrorCode =
  | "published_site_not_found"
  | "invalid_lead_payload"
  | "contact_not_found"
  | "task_not_found"
  | "opportunity_not_found"
  | "stage_not_found"
  | "duplicate_pair_not_found"
  | "duplicate_merge_invalid"
  | "contact_already_merged";

export class CrmError extends Error {
  constructor(
    public readonly code: CrmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CrmError";
  }
}
