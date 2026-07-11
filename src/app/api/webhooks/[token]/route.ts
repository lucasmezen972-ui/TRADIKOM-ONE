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
    const payload = (await request.json()) as Record<string, unknown>;
    const secret = request.headers.get("x-tradikom-secret") ?? undefined;
    const result = await services.receiveWebhook(token, payload, secret);
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
