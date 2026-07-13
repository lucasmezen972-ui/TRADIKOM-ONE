export type AnalyzerErrorCode =
  | "snapshot_not_found"
  | "openapi_invalid"
  | "openapi_unsupported"
  | "external_reference_blocked"
  | "document_too_complex"
  | "preview_required"
  | "claim_not_found";

export class AnalyzerError extends Error {
  constructor(
    public readonly code: AnalyzerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AnalyzerError";
  }
}
