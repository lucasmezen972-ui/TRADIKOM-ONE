import { NextResponse } from "next/server";
import { getServices } from "@/lib/services";
import {
  correlationId,
  getTenantIdFromCookie,
} from "@/lib/security";
import { getCurrentSession } from "@/lib/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ exportId: string }> },
) {
  const requestCorrelationId = correlationId();
  try {
    const session = await getCurrentSession();
    if (!session) {
      return safeError("Authentification requise.", 401, requestCorrelationId);
    }
    const services = await getServices();
    const context = await services.getTenantContext(
      session.user.id,
      await getTenantIdFromCookie(),
    );
    if (!context) {
      return safeError("Organisation introuvable.", 403, requestCorrelationId);
    }
    const { exportId } = await params;
    const file = await services.getUniversalExportDownload(
      session.user.id,
      context.tenant.id,
      exportId,
    );
    return new NextResponse(new Uint8Array(file.content), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Content-Type": file.contentType,
        "X-Content-Type-Options": "nosniff",
        "X-Correlation-Id": requestCorrelationId,
      },
    });
  } catch {
    return safeError(
      "Ce fichier d’export n’est pas disponible.",
      404,
      requestCorrelationId,
    );
  }
}

function safeError(message: string, status: number, requestCorrelationId: string) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Correlation-Id": requestCorrelationId,
      },
    },
  );
}
