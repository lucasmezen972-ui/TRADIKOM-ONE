export type OntologyErrorCode =
  | "mapping_not_found"
  | "mapping_not_approved"
  | "mapping_evidence_invalid"
  | "global_mapping_not_found"
  | "mapping_already_exists";

export class OntologyError extends Error {
  constructor(
    readonly code: OntologyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OntologyError";
  }
}
