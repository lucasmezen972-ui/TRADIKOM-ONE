import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const runs = await services.getWorkflowRuns(user.id, tenant.id);

  return (
    <div className="grid gap-6">
      <header>
        <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
          Workflow engine
        </p>
        <h1 className="mt-1 text-4xl font-bold">Automatisations</h1>
      </header>
      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Workflow par defaut</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {["lead.created", "create_task", "send_mock_email"].map((item) => (
            <div key={item} className="rounded-md border border-slate-200 px-4 py-3">
              {item}
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Historique</h2>
        <div className="mt-4 grid gap-3">
          {runs.map((run) => (
            <div key={run.id} className="rounded-md border border-slate-200 px-4 py-3">
              <p className="font-semibold">{run.summary}</p>
              <p className="text-sm text-slate-500">
                {run.triggerName} - {run.status}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
