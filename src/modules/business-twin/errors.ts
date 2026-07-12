export type BusinessTwinErrorCode = "business_profile_invalid";

export class BusinessTwinError extends Error {
  constructor(
    public readonly code: BusinessTwinErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BusinessTwinError";
  }
}
