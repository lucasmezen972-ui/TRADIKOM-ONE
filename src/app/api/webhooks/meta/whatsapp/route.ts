import {
  getPreparedChannelProvider,
  handlePreparedMetaWhatsAppWebhookRequest,
  receivePreparedMetaWhatsAppWebhook,
} from "@/modules/channels";
import { getDb } from "@/lib/db";
import {
  logServerError,
  resolveCorrelationId,
} from "@/modules/request-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleMetaWhatsAppWebhookRequest(request);
}

export async function POST(request: Request) {
  return handleMetaWhatsAppWebhookRequest(request);
}

async function handleMetaWhatsAppWebhookRequest(request: Request) {
  const correlationId = resolveCorrelationId(
    request.headers.get("x-correlation-id"),
  );
  const manifest = getPreparedChannelProvider("whatsapp_meta");

  try {
    const response = await handlePreparedMetaWhatsAppWebhookRequest(request, {
      state: manifest.state,
      appSecret: process.env.META_WHATSAPP_APP_SECRET,
      verifyToken: process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN,
      receive: async (input) =>
        receivePreparedMetaWhatsAppWebhook(await getDb(), input, {
          appSecret: process.env.META_WHATSAPP_APP_SECRET,
          fingerprintSecret: process.env.CONNECTOR_ENCRYPTION_KEY,
        }),
    });
    response.headers.set("x-correlation-id", correlationId);
    return response;
  } catch (error) {
    const mapped = logServerError({
      operation: "channels.meta_whatsapp_webhook",
      correlationId,
      error,
    });
    return Response.json(
      { ok: false, error: mapped.message, correlationId },
      {
        status: mapped.status,
        headers: {
          "cache-control": "no-store",
          "x-correlation-id": correlationId,
          "x-content-type-options": "nosniff",
        },
      },
    );
  }
}
