import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getPreparedChannelProvider } from "@/modules/channels";
import {
  handlePreparedResendWebhookRequest,
  receivePreparedResendWebhook,
} from "@/modules/email";
import {
  logServerError,
  resolveCorrelationId,
} from "@/modules/request-context";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const correlationId = resolveCorrelationId(
    request.headers.get("x-correlation-id"),
  );
  const manifest = getPreparedChannelProvider("email_resend");

  try {
    const response = await handlePreparedResendWebhookRequest(request, {
      state: manifest.state,
      receive: async (input) =>
        receivePreparedResendWebhook(
          await getDb(),
          input,
          process.env.RESEND_WEBHOOK_SECRET,
        ),
    });
    response.headers.set("x-correlation-id", correlationId);
    return response;
  } catch (error) {
    const mapped = logServerError({
      operation: "email.resend_webhook",
      correlationId,
      error,
    });
    return NextResponse.json(
      {
        ok: false,
        error: mapped.message,
        correlationId,
      },
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
