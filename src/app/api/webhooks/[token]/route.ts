import { NextResponse } from "next/server";
import { getServices } from "@/lib/services";
import {
  logServerError,
  resolveCorrelationId,
} from "@/modules/request-context";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const correlationId = resolveCorrelationId(
    request.headers.get("x-correlation-id"),
  );

  try {
    const services = await getServices();
    const body = await request.text();
    const payload = parseWebhookPayload(body);
    const result = await services.receiveWebhook(token, payload, {
      body,
      timestamp: request.headers.get("x-tradikom-timestamp"),
      signature: request.headers.get("x-tradikom-signature"),
      idempotencyKey: request.headers.get("x-tradikom-idempotency-key"),
    });
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "x-correlation-id": correlationId } },
    );
  } catch (error) {
    const mapped = logServerError({
      operation: "webhook.receive",
      correlationId,
      error,
    });
    const headers: Record<string, string> = {
      "x-correlation-id": correlationId,
    };
    if (mapped.retryAfterSeconds) {
      headers["Retry-After"] = String(mapped.retryAfterSeconds);
    }
    return NextResponse.json(
      {
        ok: false,
        error: mapped.message,
        correlationId,
      },
      {
        status: mapped.status,
        headers,
      },
    );
  }
}

function parseWebhookPayload(body: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new Error("Payload invalide.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Payload invalide.");
  }

  return parsed as Record<string, unknown>;
}
