export type ApiChangeMonitorErrorCode =
  | "impact_not_found"
  | "decision_invalid";

export class ApiChangeMonitorError extends Error {
  constructor(
    readonly code: ApiChangeMonitorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiChangeMonitorError";
  }
}
