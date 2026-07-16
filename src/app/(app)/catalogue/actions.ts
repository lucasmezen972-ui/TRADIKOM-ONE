"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServices } from "@/lib/services";
import { safeServerAction } from "@/lib/public-action";
import { requireTenantContext } from "@/lib/session";

export async function refreshPrivateAppMarketplaceAndRedirectAction() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const result = await safeServerAction(
    "app_marketplace.private_catalog_refresh",
    () => services.refreshPrivateAppMarketplace(user.id, tenant.id),
  );
  revalidatePath("/catalogue");
  redirect(
    `/catalogue?actualise=1&sources=${result.sourceCount}&nouvelles=${result.createdCount}`,
  );
}
