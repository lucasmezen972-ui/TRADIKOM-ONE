"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireTenantContext } from "@/lib/session";
import { safeServerAction } from "@/lib/public-action";
import { installGithubPublicConnector, refreshGithubPublicIssues, revokeGithubPublicConnector } from "@/modules/github-public/service";
export async function installGithubPublicAction(form: FormData) {
  const { user, tenant } = await requireTenantContext();
  await safeServerAction("github_public.install", async () => installGithubPublicConnector(await getDb(), user.id, tenant.id, {
    owner: String(form.get("owner") ?? ""), repository: String(form.get("repository") ?? ""), consentConfirmed: z.literal(true).parse(form.get("consent") === "true"),
  }));
  revalidatePath("/connexions/logiciels"); redirect("/connexions/logiciels#github-public");
}
export async function refreshGithubPublicAction(form: FormData) {
  const { user, tenant } = await requireTenantContext();
  await safeServerAction("github_public.refresh", async () => refreshGithubPublicIssues(await getDb(), user.id, tenant.id, String(form.get("connectorId") ?? "")));
  revalidatePath("/connexions/logiciels"); redirect("/connexions/logiciels#github-public");
}
export async function revokeGithubPublicAction(form: FormData) {
  const { user, tenant } = await requireTenantContext();
  await safeServerAction("github_public.revoke", async () => revokeGithubPublicConnector(await getDb(), user.id, tenant.id, String(form.get("connectorId") ?? "")));
  revalidatePath("/connexions/logiciels"); redirect("/connexions/logiciels#github-public");
}
