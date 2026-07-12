import { headers } from "next/headers";
import {
  resolveCorrelationId,
  toPublicActionError,
} from "@/modules/request-context";

export async function safeServerAction<T>(
  operation: string,
  action: () => Promise<T>,
) {
  const requestHeaders = await headers();
  const correlationId = resolveCorrelationId(
    requestHeaders.get("x-correlation-id"),
  );

  try {
    return await action();
  } catch (error) {
    throw toPublicActionError(operation, correlationId, error);
  }
}
