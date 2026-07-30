import { NextResponse } from "next/server";
import {
  getPreparedChannelProvider,
  handlePreparedSlackWebhookRequest,
} from "@/modules/channels";
import {
  logServerError,
  resolveCorrelationId,
} from "@/modules/request-context";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const correlationId = resolveCorrelationId(
    request.headers.get("x-correlation-id"),
  );
  const manifest = getPreparedChannelProvider("slack");

  try {
    const response = await handlePreparedSlackWebhookRequest(request, {
      state: manifest.state,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      receive: async () => ({
        accepted: false,
        code: "channel_provider_endpoint_not_found",
      }),
    });
    response.headers.set("x-correlation-id", correlationId);
    return response;
  } catch (error) {
    const mapped = logServerError({
      operation: "channels.slack_webhook",
      correlationId,
      error,
    });
    return NextResponse.json(
      { ok: false, error: mapped.message, correlationId },
      {
        status: mapped.status,
        headers: {
          "cache-control": "no-store",
          "x-correlation-id": correlationId,
        },
      },
    );
  }
}

