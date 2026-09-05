import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getPreparedChannelProvider,
  handlePreparedTeamsWebhookRequest,
  ingestPreparedTeamsMessage,
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
  const manifest = getPreparedChannelProvider("teams_microsoft");

  try {
    const response = await handlePreparedTeamsWebhookRequest(request, {
      state: manifest.state,
      clientId: process.env.MICROSOFT_CLIENT_ID,
      tenantId: process.env.MICROSOFT_TENANT_ID,
      receive: async (message) =>
        ingestPreparedTeamsMessage(await getDb(), message, {
          clientId: process.env.MICROSOFT_CLIENT_ID,
          fingerprintSecret: process.env.CONNECTOR_ENCRYPTION_KEY,
        }),
    });
    response.headers.set("x-correlation-id", correlationId);
    return response;
  } catch (error) {
    const mapped = logServerError({
      operation: "channels.microsoft_teams_webhook",
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
