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

  const { opportunity, stages, members, changes } = detail;

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
            <label className="grid gap-2 text-sm font-semibold">
              Responsable
              <select
                name="assignedUserId"
                defaultValue={opportunity.assignedUserId ?? ""}
                className="rounded-md border border-slate-200 px-4 py-3 font-normal"
              >
                <option value="">Non attribuée</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Probabilité de conclusion
              <input
                type="number"
                min="0"
                max="100"
                step="5"
                name="probability"
                defaultValue={opportunity.probability ?? ""}
                placeholder="En pourcentage"
                className="rounded-md border border-slate-200 px-4 py-3 font-normal"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Clôture estimée
              <input
                type="date"
                name="expectedCloseAt"
                defaultValue={toDateInputValue(opportunity.expectedCloseAt)}
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

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Historique des changements</h2>
        <p className="mt-1 text-sm text-slate-500">
          Chaque modification enregistrée sur cette opportunité, la plus
          récente en premier.
        </p>
        {changes.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
            Aucun changement enregistré pour l&apos;instant. L&apos;historique se
            remplit dès la première modification de cette fiche.
          </p>
        ) : (
          <ol className="mt-4 grid gap-3">
            {changes.map((change) => (
              <li
                key={change.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">
                    {changeFieldLabels[change.field] ?? change.field}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {formatChangeValue(change.field, change.previousValue)}
                    {" → "}
                    {formatChangeValue(change.field, change.nextValue)}
                  </p>
                </div>
                <p className="shrink-0 text-xs text-slate-500">
                  {change.changedByName ?? "Utilisateur supprimé"} —{" "}
                  {formatDateTime(change.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

const changeFieldLabels: Record<string, string> = {
  stage: "Étape",
  value_cents: "Valeur estimée",
  assigned_user_id: "Responsable",
  probability: "Probabilité de conclusion",
  expected_close_at: "Clôture estimée",
  next_follow_up_at: "Prochaine action",
};

function formatChangeValue(field: string, value: string | null) {
  if (value === null || value === "") {
    return "non défini";
  }
  if (field === "value_cents") {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
    }).format(Number(value) / 100);
  }
  if (field === "probability") {
    return `${value} %`;
  }
  if (field === "expected_close_at" || field === "next_follow_up_at") {
    return formatDate(value);
  }
  if (field === "assigned_user_id") {
    return "un autre responsable";
  }
  return value;
}

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(parsed);
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(parsed);
}

function toDateInputValue(value?: string) {
  return value ? value.slice(0, 10) : "";
}
