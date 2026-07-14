export type DomainConnectionErrorCode =
  | "domain_connection_not_found"
  | "domain_snapshot_not_found"
  | "dns_plan_not_found"
  | "dns_plan_invalid_state"
  | "dns_plan_expired"
  | "dns_state_changed"
  | "dns_change_blocked"
  | "provider_capability_missing";

export class DomainConnectionError extends Error {
  constructor(
    public readonly code: DomainConnectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainConnectionError";
  }
}
