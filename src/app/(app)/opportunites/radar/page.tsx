import Link from "next/link";
import { dismissOpportunityRadarAlertAction } from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import type { OpportunityRadarAlert } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function OpportunityRadarPage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const alerts = await services.getOpportunityRadar(user.id, tenant.id);
  const activeAlerts = alerts.filter((alert) => alert.status === "active");
  const dismissedAlerts = alerts.filter((alert) => alert.status === "dismissed");

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Opportunity Radar
          </p>
          <h1 className="mt-1 text-4xl font-bold">Alertes commerciales</h1>
          <p className="mt-2 text-slate-500">
            {activeAlerts.length} alerte{activeAlerts.length > 1 ? "s" : ""} active
            {activeAlerts.length > 1 ? "s" : ""}.
          </p>
        </div>
        <Link
          href="/opportunites"
          className="inline-flex rounded-md border border-slate-300 px-4 py-3 font-semibold"
        >
          Retour au pipeline
        </Link>
      </header>

      <section className="grid gap-4">
        {activeAlerts.length === 0 ? (
          <div className="rounded-lg bg-white p-5 text-slate-500 shadow-sm">
            Aucune alerte active pour le moment.
          </div>
        ) : null}
        {activeAlerts.map((alert) => (
          <AlertCard key={alert.id} alert={alert} />
        ))}
      </section>

      {dismissedAlerts.length > 0 ? (
        <section className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Ignorees</h2>
          <div className="mt-4 grid gap-3">
            {dismissedAlerts.map((alert) => (
              <div
                key={alert.id}
                className="rounded-md border border-slate-200 px-4 py-3 text-sm text-slate-500"
              >
                <p className="font-semibold text-slate-700">{alert.title}</p>
                <p className="mt-1">{alert.explanation}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function AlertCard({ alert }: { alert: OpportunityRadarAlert }) {
  return (
    <article className="grid gap-4 rounded-lg bg-white p-5 shadow-sm lg:grid-cols-[1fr_auto]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={severityClassName(alert.severity)}>{alert.severity}</span>
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            {alert.ruleKey}
          </span>
        </div>
        <h2 className="mt-3 text-xl font-bold">{alert.title}</h2>
        <p className="mt-2 text-slate-500">{alert.explanation}</p>
      </div>
      <div className="flex flex-wrap items-start gap-3 lg:justify-end">
        <Link
          href={alert.actionHref}
          className="rounded-md bg-[#08111f] px-4 py-3 text-sm font-semibold text-white"
        >
          {alert.actionLabel}
        </Link>
        <form action={dismissOpportunityRadarAlertAction}>
          <input type="hidden" name="alertId" value={alert.id} />
          <button className="rounded-md border border-slate-300 px-4 py-3 text-sm font-semibold">
            Ignorer
          </button>
        </form>
      </div>
    </article>
  );
}

function severityClassName(severity: OpportunityRadarAlert["severity"]) {
  if (severity === "critical") {
    return "rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-900";
  }
  if (severity === "warning") {
    return "rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-950";
  }
  return "rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-900";
}
