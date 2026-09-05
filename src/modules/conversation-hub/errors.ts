export type ConversationHubErrorCode =
  | "conversation_access_denied"
  | "conversation_thread_not_found"
  | "conversation_identity_conflict"
  | "conversation_identity_unavailable"
  | "conversation_idempotency_conflict"
  | "conversation_thread_access_invalid_grantee"
  | "conversation_thread_access_idempotency_conflict";

export class ConversationHubError extends Error {
  constructor(
    public readonly code: ConversationHubErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConversationHubError";
  }
}
