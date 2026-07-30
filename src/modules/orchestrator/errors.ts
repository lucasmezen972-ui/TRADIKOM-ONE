export type OrchestratorErrorCode =
  | "orchestrator_plan_incomplete"
  | "orchestrator_capability_unavailable"
  | "orchestrator_capability_mismatch"
  | "orchestrator_scope_missing"
  | "orchestrator_permission_denied"
  | "orchestrator_external_cost_forbidden"
  | "orchestrator_source_message_not_found"
  | "orchestrator_source_message_invalid"
  | "orchestrator_plan_not_found"
  | "orchestrator_approval_not_found"
  | "orchestrator_decision_conflict";

export class OrchestratorError extends Error {
  constructor(
    public readonly code: OrchestratorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OrchestratorError";
  }
}
