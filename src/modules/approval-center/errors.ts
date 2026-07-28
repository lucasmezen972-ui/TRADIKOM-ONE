export type ApprovalCenterErrorCode =
  | "approval_center_access_denied"
  | "approval_not_found"
  | "snooze_window_invalid";

export class ApprovalCenterError extends Error {
  constructor(
    readonly code: ApprovalCenterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApprovalCenterError";
  }
}
