"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServices } from "@/lib/services";
import { safeServerAction } from "@/lib/public-action";
import { requireTenantContext } from "@/lib/session";

export async function createPrivateAutomationPackageAndRedirectAction(
  formData: FormData,
) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("automation_marketplace.package_create", () =>
    services.createPrivateAutomationPackage(user.id, tenant.id, {
      listingId: text(formData, "listingId"),
    }),
  );
  revalidatePath("/bibliotheque-automatisations");
  redirect("/bibliotheque-automatisations?paquet=prepare");
}

export async function previewPrivateAutomationPackageAndRedirectAction(
  formData: FormData,
) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  await safeServerAction("automation_marketplace.package_preview", () =>
    services.previewPrivateAutomationPackage(user.id, tenant.id, {
      packageId: text(formData, "packageId"),
    }),
  );
  revalidatePath("/bibliotheque-automatisations");
  redirect("/bibliotheque-automatisations?apercu=pret");
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
