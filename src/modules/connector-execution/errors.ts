export type ConnectorExecutionErrorCode =
  | "connection_not_found"
  | "connection_not_ready"
  | "installation_not_found"
  | "installation_already_exists";

export class ConnectorExecutionError extends Error {
  readonly code: ConnectorExecutionErrorCode;

  constructor(code: ConnectorExecutionErrorCode, message: string) {
    super(message);
    this.name = "ConnectorExecutionError";
    this.code = code;
  }
}
