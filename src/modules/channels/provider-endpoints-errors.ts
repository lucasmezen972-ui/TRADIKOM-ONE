export type ChannelProviderEndpointErrorCode =
  | "channel_provider_endpoint_access_denied"
  | "channel_provider_endpoint_conflict"
  | "channel_provider_endpoint_not_found";

export class ChannelProviderEndpointError extends Error {
  constructor(
    public readonly code: ChannelProviderEndpointErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChannelProviderEndpointError";
  }
}
