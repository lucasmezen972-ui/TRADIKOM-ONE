import { NextResponse } from "next/server";
import { getServices } from "@/lib/services";
import { ConnectorError } from "@/modules/connectors";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const services = await getServices();

  try {
    const body = await request.text();
    const payload = parseWebhookPayload(body);
    const result = await services.receiveWebhook(token, payload, {
      body,
      timestamp: request.headers.get("x-tradikom-timestamp"),
      signature: request.headers.get("x-tradikom-signature"),
      idempotencyKey: request.headers.get("x-tradikom-idempotency-key"),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const retryAfter =
      error instanceof ConnectorError && error.retryAfterSeconds
        ? String(error.retryAfterSeconds)
        : undefined;
    return NextResponse.json(
      {
        ok: false,
        error: safeWebhookError(error),
      },
      {
        status: webhookErrorStatus(error),
        headers: retryAfter ? { "Retry-After": retryAfter } : undefined,
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

function safeWebhookError(error: unknown) {
  if (error instanceof ConnectorError) {
    if (error.code === "webhook_rate_limited") {
      return "Webhook temporairement limite.";
    }

    if (error.code === "webhook_duplicate") {
      return "Livraison webhook deja recue.";
    }

    if (error.code === "webhook_oversized") {
      return "Payload webhook trop volumineux.";
    }

    return "Webhook rejete.";
  }

  return "Payload invalide.";
}

function webhookErrorStatus(error: unknown) {
  if (error instanceof ConnectorError) {
    if (error.code === "webhook_rate_limited") {
      return 429;
    }

    if (error.code === "webhook_duplicate") {
      return 409;
    }

    if (error.code === "webhook_oversized") {
      return 413;
    }

    if (error.code === "webhook_disabled") {
      return 403;
    }
  }

  return 400;
}
