import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  logServerError,
  resolveCorrelationId,
} from "@/modules/request-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = resolveCorrelationId(
    request.headers.get("x-correlation-id"),
  );
  try {
    const db = await getDb();
    await db.query("select 1");
    return NextResponse.json(
      {
        ok: true,
        service: "tradikom-one",
        database: "ok",
        timestamp: new Date().toISOString(),
      },
      { headers: { "x-correlation-id": correlationId } },
    );
  } catch (error) {
    logServerError({ operation: "health.check", correlationId, error });
    return NextResponse.json(
      { ok: false, error: "Service temporairement indisponible.", correlationId },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "x-correlation-id": correlationId,
        },
      },
    );
  }
}
