import { NextResponse, type NextRequest } from "next/server";
import { resolveCorrelationId } from "@/modules/request-context/correlation";

export function proxy(request: NextRequest) {
  const correlationId = resolveCorrelationId(
    request.headers.get("x-correlation-id"),
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-correlation-id", correlationId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("x-correlation-id", correlationId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
