export type ConnectorErrorCode =
  | "webhook_invalid"
  | "webhook_duplicate"
  | "webhook_idempotency_missing"
  | "webhook_oversized"
  | "webhook_payload_invalid"
  | "webhook_rate_limited"
  | "webhook_signature_invalid";

export class ConnectorError extends Error {
  constructor(
    public readonly code: ConnectorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
