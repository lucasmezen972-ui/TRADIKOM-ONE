export type SoftwareDirectoryErrorCode =
  | "software_not_found"
  | "domain_not_found"
  | "domain_not_approved"
  | "source_not_found"
  | "api_product_not_found"
  | "publisher_domain_mismatch";

export class SoftwareDirectoryError extends Error {
  constructor(
    public readonly code: SoftwareDirectoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SoftwareDirectoryError";
  }
}
