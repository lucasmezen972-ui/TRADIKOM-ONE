import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getPreparedChannelProvider,
  handlePreparedTwilioWebhookRequest,
  receivePreparedWhatsAppWebhook,
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
  const manifest = getPreparedChannelProvider("whatsapp_twilio");

  try {
    const response = await handlePreparedTwilioWebhookRequest(request, {
      state: manifest.state,
      verificationUrl: process.env.TWILIO_WHATSAPP_WEBHOOK_URL,
      receive: async (input) =>
        receivePreparedWhatsAppWebhook(await getDb(), input, {
          authToken: process.env.TWILIO_AUTH_TOKEN,
          fingerprintSecret: process.env.CONNECTOR_ENCRYPTION_KEY,
        }),
    });
    response.headers.set("x-correlation-id", correlationId);
    return response;
  } catch (error) {
    const mapped = logServerError({
      operation: "channels.twilio_whatsapp_webhook",
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
