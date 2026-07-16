import { isTrustedFormOrigin, redirectFormPost } from "@/lib/form-post";
import { getTenantIdFromCookie } from "@/lib/security";
import { getServices } from "@/lib/services";
import { getCurrentSession } from "@/lib/session";

export async function POST(request: Request) {
  if (!isTrustedFormOrigin(request)) {
    return redirectFormPost("/catalogue?erreur=origine");
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
    const result = await services.refreshPrivateAppMarketplace(
      session.user.id,
      context.tenant.id,
    );
    return redirectFormPost(
      `/catalogue?actualise=1&sources=${result.sourceCount}&nouvelles=${result.createdCount}`,
    );
  } catch {
    return redirectFormPost("/catalogue?erreur=actualisation");
  }
}
