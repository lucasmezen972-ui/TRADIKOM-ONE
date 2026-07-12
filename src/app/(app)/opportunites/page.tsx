import Link from "next/link";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

type OpportunitiesPageProps = {
  searchParams: Promise<{ q?: string; stageId?: string }>;
};

export default async function OpportunitiesPage({
  searchParams,
}: OpportunitiesPageProps) {
  const params = await searchParams;
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const [dashboard, pipeline] = await Promise.all([
    services.getDashboard(user.id, tenant.id),
    services.getOpportunities(user.id, tenant.id, {
      search: params.q,
      stageId: params.stageId,
    }),
  ]);

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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">Pipeline commercial</h2>
            <p className="mt-1 text-sm text-slate-500">
              Recherche, filtre par etape et acces au detail.
            </p>
          </div>
          <form className="grid w-full gap-3 md:w-auto md:grid-cols-[16rem_14rem_auto]">
            <input
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Nom ou email"
              className="rounded-md border border-slate-200 px-4 py-3"
            />
            <select
              name="stageId"
              defaultValue={params.stageId ?? ""}
              className="rounded-md border border-slate-200 px-4 py-3"
            >
              <option value="">Toutes les etapes</option>
              {pipeline.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
            <button className="rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
              Filtrer
            </button>
          </form>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="py-3">Contact</th>
                <th>Etape</th>
                <th>Valeur</th>
                <th>Prochaine action</th>
                <th>Perte</th>
              </tr>
            </thead>
            <tbody>
              {pipeline.opportunities.map((opportunity) => (
                <tr key={opportunity.id} className="border-t border-slate-100">
                  <td className="py-3">
                    <Link
                      href={`/opportunites/${opportunity.id}`}
                      className="font-semibold text-slate-950 underline-offset-4 hover:underline"
                    >
                      {opportunity.contactName}
                    </Link>
                    <p className="text-sm text-slate-500">{opportunity.contactEmail}</p>
                  </td>
                  <td>{opportunity.stageName}</td>
                  <td>{formatCurrency(opportunity.valueCents)}</td>
                  <td>
                    {opportunity.nextFollowUpAt
                      ? new Date(opportunity.nextFollowUpAt).toLocaleDateString("fr-FR")
                      : "Non planifiee"}
                  </td>
                  <td>{opportunity.lostReason ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-lg bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">Opportunity Radar</h2>
            <p className="mt-1 text-sm text-slate-500">
              Alertes actives avec action directe.
            </p>
          </div>
          <Link
            href="/opportunites/radar"
            className="rounded-md bg-[#08111f] px-4 py-3 text-sm font-semibold text-white"
          >
            Ouvrir le radar
          </Link>
        </div>
        <div className="mt-4 grid gap-3">
          {dashboard.detectedOpportunities.length === 0 ? (
            <div className="rounded-md border border-slate-200 px-4 py-3 text-slate-500">
              Aucune alerte active.
            </div>
          ) : null}
          {dashboard.detectedOpportunities.slice(0, 6).map((alert) => (
            <Link
              key={alert.id}
              href={alert.actionHref}
              className="rounded-md border border-slate-200 px-4 py-3"
            >
              <p className="font-semibold">{alert.title}</p>
              <p className="mt-1 text-sm text-slate-500">{alert.explanation}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatCurrency(valueCents: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(valueCents / 100);
}
