import { NextResponse } from "next/server";
import { getTenantIdFromCookie } from "@/lib/security";
import { getServices } from "@/lib/services";
import { getCurrentSession } from "@/lib/session";

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  if (request.headers.get("origin") !== requestUrl.origin) {
    return NextResponse.redirect(
      new URL("/bibliotheque-automatisations?erreur=origine", requestUrl),
      303,
    );
  }

  const services = await getServices();
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.redirect(new URL("/", requestUrl), 303);
  }
  const context = await services.getTenantContext(
    session.user.id,
    await getTenantIdFromCookie(),
  );
  if (!context) {
    return NextResponse.redirect(new URL("/creer-organisation", requestUrl), 303);
  }

  try {
    const formData = await request.formData();
    await services.createPrivateAutomationPackage(
      session.user.id,
      context.tenant.id,
      { listingId: text(formData, "listingId") },
    );
    return NextResponse.redirect(
      new URL("/bibliotheque-automatisations?paquet=prepare", requestUrl),
      303,
    );
  } catch {
    return NextResponse.redirect(
      new URL("/bibliotheque-automatisations?erreur=paquet", requestUrl),
      303,
    );
  }
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
