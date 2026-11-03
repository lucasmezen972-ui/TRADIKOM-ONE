import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getPreparedChannelProvider,
  handlePreparedTwilioWebhookRequest,
  receivePreparedWhatsAppDeliveryStatus,
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
      verificationUrl: process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL,
      receive: async (input) =>
        receivePreparedWhatsAppDeliveryStatus(await getDb(), input, {
          authToken: process.env.TWILIO_AUTH_TOKEN,
        }),
    });
    response.headers.set("x-correlation-id", correlationId);
    return response;
  } catch (error) {
    const mapped = logServerError({
      operation: "channels.twilio_whatsapp_delivery_status",
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
