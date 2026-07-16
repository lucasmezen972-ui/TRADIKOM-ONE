export type DomainConnectionErrorCode =
  | "domain_connection_not_found"
  | "domain_snapshot_not_found"
  | "dns_plan_not_found"
  | "dns_plan_invalid_state"
  | "dns_plan_expired"
  | "dns_state_changed"
  | "dns_change_blocked"
  | "provider_capability_missing"
  | "mock_domain_required"
  | "domain_verification_unavailable"
  | "dns_plan_not_simulated"
  | "website_not_published"
  | "domain_binding_not_created"
  | "domain_verification_not_found"
  | "domain_verification_in_progress"
  | "domain_binding_invalid_state"
  | "domain_binding_evidence_missing"
  | "domain_binding_not_found";

export class DomainConnectionError extends Error {
  constructor(
    public readonly code: DomainConnectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainConnectionError";
  }
}
