export type ConnectorErrorCode =
  | "webhook_invalid"
  | "webhook_payload_invalid"
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
