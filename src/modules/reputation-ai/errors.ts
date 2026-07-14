export class ReputationAiError extends Error {
  constructor(
    readonly code:
      | "reputation_review_duplicate"
      | "reputation_proposal_not_proposed"
      | "reputation_proposal_not_pending",
    message: string,
  ) {
    super(message);
    this.name = "ReputationAiError";
  }
}
