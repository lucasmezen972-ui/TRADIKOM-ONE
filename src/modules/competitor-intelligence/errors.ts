export class CompetitorIntelligenceError extends Error {
  constructor(
    readonly code:
      | "competitor_duplicate"
      | "competitor_not_found"
      | "competitor_observation_duplicate"
      | "competitor_insight_not_proposed"
      | "competitor_insight_not_pending",
    message: string,
  ) {
    super(message);
    this.name = "CompetitorIntelligenceError";
  }
}
