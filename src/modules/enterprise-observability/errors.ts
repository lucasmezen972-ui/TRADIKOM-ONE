export class EnterpriseObservabilityError extends Error {
  constructor(
    public readonly code: "enterprise_observability_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "EnterpriseObservabilityError";
  }
}
