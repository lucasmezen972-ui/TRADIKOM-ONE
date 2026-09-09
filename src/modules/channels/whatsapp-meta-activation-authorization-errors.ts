export type WhatsAppMetaActivationAuthorizationErrorCode =
  | "channel_provider_activation_authorization_access_denied"
  | "channel_provider_activation_authorization_idempotency_conflict"
  | "channel_provider_activation_authorization_invalid"
  | "channel_provider_activation_authorization_not_found";

export class WhatsAppMetaActivationAuthorizationError extends Error {
  constructor(
    public readonly code: WhatsAppMetaActivationAuthorizationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WhatsAppMetaActivationAuthorizationError";
  }
}
