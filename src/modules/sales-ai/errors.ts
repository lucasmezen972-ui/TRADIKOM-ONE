export class SalesAiError extends Error {
  constructor(
    readonly code: "sales_ai_evidence_required",
    message: string,
  ) {
    super(message);
    this.name = "SalesAiError";
  }
}
