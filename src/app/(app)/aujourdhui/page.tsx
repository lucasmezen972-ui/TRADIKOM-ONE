import Link from "next/link";
import { ClipboardList, Contact, Globe2, Target } from "lucide-react";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const dashboard = await services.getDashboard(user.id, tenant.id);

  const metrics = [
    {
      label: "Nouveaux leads",
      value: dashboard.metrics.newLeads,
      icon: Target,
    },
    {
      label: "Contacts",
      value: dashboard.metrics.contacts,
      icon: Contact,
    },
    {
      label: "Relances a faire",
      value: dashboard.metrics.pendingTasks,
      icon: ClipboardList,
    },
    {
      label: "Statut site",
      value: dashboard.websiteStatus,
      icon: Globe2,
    },
  ];

  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Aujourd&apos;hui
          </p>
          <h1 className="mt-1 text-4xl font-bold text-slate-950">
            Priorites de {dashboard.tenant.name}
          </h1>
        </div>
        <Link
          href="/mon-site"
          className="inline-flex w-fit rounded-md bg-[#08111f] px-4 py-3 font-semibold text-white"
        >
          Ouvrir le site
        </Link>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="rounded-lg bg-white p-5 shadow-sm">
              <Icon size={20} className="text-[#0b8f84]" aria-hidden />
              <p className="mt-4 text-sm text-slate-500">{metric.label}</p>
              <p className="mt-1 text-3xl font-bold">{metric.value}</p>
            </div>
          );
        })}
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Opportunites detectees</h2>
          <div className="mt-4 grid gap-3">
            {dashboard.detectedOpportunities.map((item) => (
              <div
                key={item}
                className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
              >
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Sante des connexions</h2>
          <div className="mt-4 grid gap-3">
            {dashboard.connectorHealth.slice(0, 3).map((connector) => (
              <div
                key={connector.key}
                className="flex items-center justify-between rounded-md border border-slate-200 px-4 py-3"
              >
                <div>
                  <p className="font-semibold">{connector.name}</p>
                  <p className="text-sm text-slate-500">{connector.status}</p>
                </div>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold">
                  {connector.health}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Pipeline</h2>
          <div className="mt-4 grid gap-3">
            {dashboard.opportunitiesByStage.map((stage) => (
              <div key={stage.stage} className="grid gap-2">
                <div className="flex justify-between text-sm">
                  <span>{stage.stage}</span>
                  <strong>{stage.count}</strong>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-[#19c6b7]"
                    style={{ width: `${Math.min(100, stage.count * 28)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Activite recente</h2>
          <div className="mt-4 grid gap-3">
            {dashboard.recentActivities.map((activity) => (
              <div key={activity.id} className="rounded-md border border-slate-200 px-4 py-3">
                <p className="font-semibold">{activity.summary}</p>
                <p className="text-sm text-slate-500">{activity.type}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Executions workflow</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {dashboard.workflowRuns.map((run) => (
            <div key={run.id} className="rounded-md border border-slate-200 px-4 py-3">
              <p className="font-semibold">{run.summary}</p>
              <p className="mt-1 text-sm text-slate-500">
                {run.triggerName} - {run.status}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
