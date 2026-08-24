export type EmailSuppressionErrorCode =
  | "email_suppressed"
  | "email_suppression_not_found";

export class EmailSuppressionError extends Error {
  constructor(
    public readonly code: EmailSuppressionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EmailSuppressionError";
  }
}
