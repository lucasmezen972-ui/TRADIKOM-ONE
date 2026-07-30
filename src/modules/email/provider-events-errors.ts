export type EmailProviderEventErrorCode =
  | "email_provider_access_denied"
  | "email_provider_delivery_conflict"
  | "email_provider_delivery_not_found"
  | "email_provider_event_conflict";

export class EmailProviderEventError extends Error {
  constructor(
    public readonly code: EmailProviderEventErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EmailProviderEventError";
  }
}
