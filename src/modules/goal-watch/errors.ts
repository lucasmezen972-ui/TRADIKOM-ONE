export type GoalWatchErrorCode =
  | "goal_watch_not_found"
  | "goal_watch_consent_required"
  | "goal_watch_inactive"
  | "goal_watch_version_conflict"
  | "goal_watch_transition_invalid"
  | "goal_watch_thread_not_found"
  | "goal_watch_thread_unavailable"
  | "goal_watch_state_corrupted"
  | "goal_watch_evaluation_conflict"
  | "goal_watch_system_actor_invalid";

export class GoalWatchError extends Error {
  constructor(
    public readonly code: GoalWatchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GoalWatchError";
  }
}
