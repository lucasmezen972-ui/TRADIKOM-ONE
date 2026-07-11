export type WorkflowErrorCode =
  | "workflow_not_found"
  | "workflow_definition_invalid"
  | "workflow_action_invalid"
  | "workflow_action_failed";

export class WorkflowError extends Error {
  constructor(
    public readonly code: WorkflowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}
