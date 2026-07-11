import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const dashboard = await services.getDashboard(user.id, tenant.id);

  return (
    <div className="grid gap-6">
      <header>
        <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
          Pipeline
        </p>
        <h1 className="mt-1 text-4xl font-bold">Opportunites</h1>
      </header>
      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {dashboard.opportunitiesByStage.map((stage) => (
          <div key={stage.stage} className="rounded-lg bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{stage.stage}</p>
            <p className="mt-3 text-3xl font-bold">{stage.count}</p>
          </div>
        ))}
      </section>
      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Regles d&apos;opportunite</h2>
        <div className="mt-4 grid gap-3">
          {dashboard.detectedOpportunities.map((item) => (
            <div key={item} className="rounded-md border border-slate-200 px-4 py-3">
              {item}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
