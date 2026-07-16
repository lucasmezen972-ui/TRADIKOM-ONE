import { isTrustedFormOrigin, redirectFormPost } from "@/lib/form-post";
import { getTenantIdFromCookie } from "@/lib/security";
import { getServices } from "@/lib/services";
import { getCurrentSession } from "@/lib/session";

export async function POST(request: Request) {
  if (!isTrustedFormOrigin(request)) {
    return redirectFormPost("/bibliotheque-automatisations?erreur=origine");
  }

  const services = await getServices();
  const session = await getCurrentSession();
  if (!session) {
    return redirectFormPost("/");
  }
  const context = await services.getTenantContext(
    session.user.id,
    await getTenantIdFromCookie(),
  );
  if (!context) {
    return redirectFormPost("/creer-organisation");
  }

  try {
    const formData = await request.formData();
    await services.createPrivateAutomationPackage(
      session.user.id,
      context.tenant.id,
      { listingId: text(formData, "listingId") },
    );
    return redirectFormPost("/bibliotheque-automatisations?paquet=prepare");
  } catch {
    return redirectFormPost("/bibliotheque-automatisations?erreur=paquet");
  }
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
