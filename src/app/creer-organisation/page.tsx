import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { createOrganizationAction } from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CreateOrganizationPage() {
  const user = await requireUser();
  const services = await getServices();
  const tenants = await services.getUserTenants(user.id);

  if (tenants.length > 0) {
    redirect("/aujourdhui");
  }

  return (
    <main className="min-h-screen bg-[#08111f] px-5 py-10 text-white">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-lg bg-[#19c6b7] text-[#08111f]">
            <Building2 size={22} aria-hidden />
          </span>
          <div>
            <p className="text-sm uppercase tracking-[0.16em] text-white/50">
              Etape 1
            </p>
            <h1 className="text-3xl font-bold">Creer votre organisation</h1>
          </div>
        </div>
        <form
          action={createOrganizationAction}
          className="grid gap-4 rounded-lg bg-[#fffaf1] p-6 text-slate-950 shadow-2xl"
        >
          <label className="grid gap-2">
            <span className="font-semibold">Nom de l&apos;entreprise</span>
            <input
              required
              name="name"
              placeholder="Garage Caraibes Auto"
              className="rounded-md border border-slate-200 px-4 py-3"
            />
          </label>
          <label className="grid gap-2">
            <span className="font-semibold">Categorie</span>
            <input
              required
              name="category"
              placeholder="Garage automobile"
              className="rounded-md border border-slate-200 px-4 py-3"
            />
          </label>
          <button className="rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
            Continuer vers l&apos;onboarding
          </button>
        </form>
      </div>
    </main>
  );
}
