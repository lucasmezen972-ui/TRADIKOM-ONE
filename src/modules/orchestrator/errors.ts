export type OrchestratorErrorCode =
  | "orchestrator_plan_incomplete"
  | "orchestrator_capability_unavailable"
  | "orchestrator_capability_mismatch"
  | "orchestrator_scope_missing"
  | "orchestrator_permission_denied"
  | "orchestrator_external_cost_forbidden";

export class OrchestratorError extends Error {
  constructor(
    public readonly code: OrchestratorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OrchestratorError";
  }
}
