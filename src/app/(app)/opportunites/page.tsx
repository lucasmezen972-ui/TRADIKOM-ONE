import Link from "next/link";
import { PipelineBoard } from "@/components/pipeline-board";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

type OpportunitiesPageProps = {
  searchParams: Promise<{
    q?: string;
    stageId?: string;
    filtre?: string;
    vue?: string;
    deplacement?: string;
  }>;
};

export default async function OpportunitiesPage({
  searchParams,
}: OpportunitiesPageProps) {
  const params = await searchParams;
  const followUpDue = params.filtre === "relance";
  const stalled = params.filtre === "bloquees";
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const [dashboard, pipeline] = await Promise.all([
    services.getDashboard(user.id, tenant.id),
    services.getOpportunities(user.id, tenant.id, {
      search: params.q,
      stageId: params.stageId,
      followUpDue,
      stalled,
    }),
  ]);
  const boardView = params.vue === "tableau";
  const stalledDays = tenant.stalledOpportunityDays;
  const activeFilter = followUpDue
    ? "Opportunités à relancer (échéance aujourd'hui ou dépassée)"
    : stalled
      ? `Opportunités bloquées (sans avancée depuis plus de ${stalledDays} jours)`
      : null;

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
      {activeFilter ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#0b8f84] bg-[#0b8f84]/5 px-4 py-3">
          <span className="rounded-full bg-[#0b8f84] px-3 py-1 text-sm font-semibold text-white">
            Filtre actif : {activeFilter}
          </span>
          <Link
            href="/opportunites"
            className="text-sm font-semibold text-[#0b8f84] underline-offset-4 hover:underline"
          >
            Retirer le filtre
          </Link>
        </div>
      ) : null}
      {params.deplacement === "ok" ? (
        <p
          role="status"
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900"
        >
          Opportunité déplacée. Le changement est enregistré dans son historique.
        </p>
      ) : null}
      {params.deplacement === "introuvable" ? (
        <p
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
        >
          Cette opportunité n&apos;existe plus. Le tableau a été rechargé.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link
          href={buildViewHref(params, undefined)}
          aria-current={boardView ? undefined : "page"}
          className={`rounded-md px-4 py-2 text-sm font-semibold ${
            boardView
              ? "border border-slate-300 bg-white text-slate-800"
              : "bg-[#08111f] text-white"
          }`}
        >
          Vue liste
        </Link>
        <Link
          href={buildViewHref(params, "tableau")}
          aria-current={boardView ? "page" : undefined}
          className={`rounded-md px-4 py-2 text-sm font-semibold ${
            boardView
              ? "bg-[#08111f] text-white"
              : "border border-slate-300 bg-white text-slate-800"
          }`}
        >
          Vue tableau
        </Link>
      </div>

      {boardView ? (
        <section className="rounded-lg bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-xl font-bold">Tableau par étape</h2>
            <p className="mt-1 text-sm text-slate-500">
              Faites glisser une carte vers une autre colonne, ou utilisez le
              menu « Déplacer » de la carte — les deux enregistrent le
              changement dans l&apos;historique de l&apos;opportunité.
            </p>
          </div>
          {pipeline.opportunities.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
              Aucune opportunité à afficher. Retirez le filtre ou créez une
              opportunité depuis la fiche d&apos;un contact.
            </p>
          ) : (
            <PipelineBoard
              stages={pipeline.stages.map((stage) => ({
                id: stage.id,
                name: stage.name,
              }))}
              cards={pipeline.opportunities.map((opportunity) => ({
                id: opportunity.id,
                contactName: opportunity.contactName,
                contactEmail: opportunity.contactEmail,
                stageId: opportunity.stageId,
                valueLabel: formatCurrency(opportunity.valueCents),
                probability: opportunity.probability,
                expectedCloseLabel: opportunity.expectedCloseAt
                  ? new Date(opportunity.expectedCloseAt).toLocaleDateString("fr-FR")
                  : undefined,
              }))}
            />
          )}
        </section>
      ) : (
      <section className="rounded-lg bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">Pipeline commercial</h2>
            <p className="mt-1 text-sm text-slate-500">
              Recherche, filtre par etape et acces au detail.
            </p>
          </div>
          <form className="grid w-full gap-3 md:w-auto md:grid-cols-[16rem_14rem_auto]">
            {params.filtre ? (
              <input type="hidden" name="filtre" value={params.filtre} />
            ) : null}
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
        {pipeline.opportunities.length === 0 ? (
          <div className="mt-5 rounded-md border border-dashed border-slate-300 px-4 py-5">
            <p className="font-semibold text-slate-700">
              {followUpDue
                ? "Aucune opportunité à relancer. Toutes les relances sont à jour."
                : stalled
                  ? "Aucune opportunité bloquée. Toutes vos ventes ouvertes ont avancé récemment."
                  : "Aucune opportunité ne correspond à ces critères."}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {followUpDue
                ? "Planifiez une prochaine action sur vos opportunités ouvertes pour ne perdre aucune vente."
                : stalled
                  ? `Une opportunité apparaît ici quand elle reste ouverte plus de ${stalledDays} jours sans avancer, faute d'action planifiée ou de relance effectuée.`
                  : "Modifiez la recherche ou le filtre d'étape, ou créez une opportunité depuis la fiche d'un contact."}
            </p>
          </div>
        ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="py-3">Contact</th>
                <th>Etape</th>
                <th>Valeur</th>
                <th>Probabilité</th>
                <th>Clôture estimée</th>
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
                    {opportunity.probability === undefined
                      ? "-"
                      : `${opportunity.probability} %`}
                  </td>
                  <td>
                    {opportunity.expectedCloseAt
                      ? new Date(opportunity.expectedCloseAt).toLocaleDateString("fr-FR")
                      : "-"}
                  </td>
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
        )}
      </section>
      )}
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

function buildViewHref(
  params: { q?: string; stageId?: string; filtre?: string },
  view: "tableau" | undefined,
) {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.stageId) search.set("stageId", params.stageId);
  if (params.filtre) search.set("filtre", params.filtre);
  if (view) search.set("vue", view);
  const query = search.toString();
  return query ? `/opportunites?${query}` : "/opportunites";
}

function formatCurrency(valueCents: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(valueCents / 100);
}
