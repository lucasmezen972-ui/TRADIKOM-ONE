export type DashboardErrorCode = "dashboard_access_denied";

export class DashboardError extends Error {
  constructor(
    public readonly code: DashboardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DashboardError";
  }
}
