export type ConnectorCopilotErrorCode =
  | "compatibility_not_found"
  | "compatibility_not_ready"
  | "unsupported_authentication"
  | "unsupported_operation"
  | "proposal_not_found"
  | "contract_test_required"
  | "approval_not_found"
  | "approval_state_invalid";

export class ConnectorCopilotError extends Error {
  constructor(
    public readonly code: ConnectorCopilotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorCopilotError";
  }
}
