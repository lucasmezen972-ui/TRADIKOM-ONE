import "server-only";

import { NextResponse } from "next/server";
import { resolveAppUrl } from "@/modules/email";

export function isTrustedFormOrigin(request: Request) {
  return request.headers.get("origin") === resolveAppUrl();
}

export function redirectFormPost(path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Form redirect path must stay on the application origin.");
  }

  return new NextResponse(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      Location: path,
    },
  });
}
