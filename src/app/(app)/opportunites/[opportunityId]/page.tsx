import Link from "next/link";
import { notFound } from "next/navigation";
import { updateOpportunityAction } from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

type OpportunityDetailPageProps = {
  params: Promise<{ opportunityId: string }>;
};

export default async function OpportunityDetailPage({
  params,
}: OpportunityDetailPageProps) {
  const { opportunityId } = await params;
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const detail = await services.getOpportunityDetail(
    user.id,
    tenant.id,
    opportunityId,
  );

  if (!detail) {
    notFound();
  }

  const { opportunity, stages } = detail;

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Opportunite
          </p>
          <h1 className="mt-1 text-4xl font-bold">{opportunity.contactName}</h1>
          <p className="mt-2 text-slate-500">
            {opportunity.contactEmail} - {opportunity.stageName}
          </p>
        </div>
        <Link
          href={`/contacts/${opportunity.contactId}`}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold"
        >
          Voir le contact
        </Link>
      </header>

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <form action={updateOpportunityAction} className="grid gap-5">
          <input type="hidden" name="opportunityId" value={opportunity.id} />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">Qualification commerciale</h2>
              <p className="mt-1 text-sm text-slate-500">
                Etape, valeur, prochaine action et raison de perte.
              </p>
            </div>
            <button className="rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
              Enregistrer
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold">
              Etape
              <select
                name="stageId"
                defaultValue={opportunity.stageId}
                className="rounded-md border border-slate-200 px-4 py-3 font-normal"
              >
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Valeur estimee
              <input
                type="number"
                min="0"
                step="0.01"
                name="valueEuros"
                defaultValue={(opportunity.valueCents / 100).toFixed(2)}
                className="rounded-md border border-slate-200 px-4 py-3 font-normal"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Prochaine action
              <input
                type="date"
                name="nextFollowUpAt"
                defaultValue={toDateInputValue(opportunity.nextFollowUpAt)}
                className="rounded-md border border-slate-200 px-4 py-3 font-normal"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold md:col-span-2">
              Raison de perte
              <textarea
                name="lostReason"
                rows={4}
                defaultValue={opportunity.lostReason ?? ""}
                placeholder="Prix, delai, hors zone, deja equipe..."
                className="rounded-md border border-slate-200 px-4 py-3 font-normal"
              />
            </label>
          </div>
        </form>
      </section>
    </div>
  );
}

function toDateInputValue(value?: string) {
  return value ? value.slice(0, 10) : "";
}
