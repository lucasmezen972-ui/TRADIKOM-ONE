export class RateLimitError extends Error {
  readonly code = "rate_limit_exceeded";

  constructor(
    public readonly retryAfterSeconds: number,
    message = "Trop de tentatives. Reessayez plus tard.",
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}
