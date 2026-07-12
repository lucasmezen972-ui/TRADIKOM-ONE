export type NotificationErrorCode =
  | "notification_not_found"
  | "notification_invalid"
  | "notification_recipient_not_found";

export class NotificationError extends Error {
  constructor(
    public readonly code: NotificationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NotificationError";
  }
}
