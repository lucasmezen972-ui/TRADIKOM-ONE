import { NextResponse } from "next/server";
import { getServices } from "@/lib/services";

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
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erreur webhook",
      },
      { status: 400 },
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
