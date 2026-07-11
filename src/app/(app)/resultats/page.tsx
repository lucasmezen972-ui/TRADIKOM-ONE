import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const dashboard = await services.getDashboard(user.id, tenant.id);

  return (
    <div className="grid gap-6">
      <header>
        <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
          Resultats
        </p>
        <h1 className="mt-1 text-4xl font-bold">Indicateurs utiles</h1>
      </header>
      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Leads" value={dashboard.metrics.newLeads} />
        <Metric label="Contacts" value={dashboard.metrics.contacts} />
        <Metric label="Formulaires" value={dashboard.metrics.formSubmissions} />
        <Metric label="Taches ouvertes" value={dashboard.metrics.pendingTasks} />
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-bold">{value}</p>
    </div>
  );
}
