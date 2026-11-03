export type ChannelProviderSecretErrorCode =
  | "channel_provider_secret_access_denied"
  | "channel_provider_secret_reference_invalid"
  | "channel_provider_secret_idempotency_conflict"
  | "channel_provider_secret_not_configured"
  | "channel_provider_secret_crypto_failed";

export class ChannelProviderSecretError extends Error {
  constructor(
    public readonly code: ChannelProviderSecretErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChannelProviderSecretError";
  }
}
