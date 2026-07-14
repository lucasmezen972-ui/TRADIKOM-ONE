export type DiscoveryErrorCode =
  | "source_not_found"
  | "source_not_official"
  | "domain_not_approved"
  | "domain_not_found"
  | "candidate_not_found"
  | "candidate_decision_invalid"
  | "url_not_allowed"
  | "private_address_blocked"
  | "robots_denied"
  | "robots_unavailable"
  | "redirect_blocked"
  | "response_too_large"
  | "unsupported_encoding"
  | "request_failed"
  | "request_timed_out"
  | "sitemap_invalid"
  | "sitemap_limit_exceeded"
  | "not_modified_without_snapshot";

export class DiscoveryError extends Error {
  constructor(
    public readonly code: DiscoveryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DiscoveryError";
  }
}
