export class ApprovalCenterError extends Error {
  constructor(
    readonly code: "approval_center_access_denied",
    message: string,
  ) {
    super(message);
    this.name = "ApprovalCenterError";
  }
}
