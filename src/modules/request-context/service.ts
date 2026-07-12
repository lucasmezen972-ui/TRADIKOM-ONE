import { toPublicError } from "@/modules/request-context/public-errors";

export class PublicActionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly correlationId: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "PublicActionError";
  }
}

export function logServerError(input: {
  operation: string;
  correlationId: string;
  error: unknown;
}) {
  const mapped = toPublicError(input.error);
  console.error(
    JSON.stringify({
      level: mapped.status >= 500 ? "error" : "warn",
      event: "request.failed",
      operation: input.operation,
      correlationId: input.correlationId,
      code: mapped.code,
      classification: mapped.classification,
      status: mapped.status,
      errorType:
        input.error instanceof Error ? input.error.name : typeof input.error,
    }),
  );
  return mapped;
}

export function toPublicActionError(
  operation: string,
  correlationId: string,
  error: unknown,
) {
  const mapped = logServerError({ operation, correlationId, error });
  return new PublicActionError(
    `${mapped.message} Référence : ${correlationId}`,
    mapped.code,
    correlationId,
    mapped.status,
    mapped.retryAfterSeconds,
  );
}
