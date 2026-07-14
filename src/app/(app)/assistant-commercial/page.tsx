import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleGauge,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { generateSalesAiAssessmentsAction } from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import type { SalesAiPriority } from "@/modules/sales-ai";

export const dynamic = "force-dynamic";

type SalesAiPageProps = {
  searchParams: Promise<{ analyse?: string; nouvelles?: string }>;
};

export default async function SalesAiPage({ searchParams }: SalesAiPageProps) {
  const params = await searchParams;
  const { user, tenant, membership } = await requireTenantContext();
  const services = await getServices();
  const assessments = await services.getSalesAiWorkspace(user.id, tenant.id);
  const canGenerate = ["owner", "administrator", "manager"].includes(
    membership.role,
  );
  const highPriority = assessments.filter(
    (assessment) => assessment.priority === "high",
  ).length;
  const averageEstimate = assessments.length
    ? Math.round(
        assessments.reduce(
          (total, assessment) => total + assessment.closingEstimate,
          0,
        ) / assessments.length,
      )
    : 0;

  return (
    <div className="grid gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Priorisation du pipeline
          </p>
          <h1 className="mt-1 text-4xl font-bold">Assistant commercial</h1>
        </div>
        {canGenerate ? (
          <form action={generateSalesAiAssessmentsAction}>
            <button className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
              <RefreshCw size={18} aria-hidden />
              Actualiser l&apos;analyse
            </button>
          </form>
        ) : null}
      </header>

      <div className="flex items-start gap-3 rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
        <ShieldCheck className="mt-0.5 shrink-0" size={19} aria-hidden />
        <p>
          Les scores sont des indicateurs déterministes fondés sur les données du
          CRM. Aucun message, devis, prix, remise ou contact n&apos;est créé ni envoyé.
        </p>
      </div>

      {params.analyse ? (
        <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">
          <Check size={18} aria-hidden />
          Analyse terminée : {Number(params.nouvelles ?? 0)} nouvelle
          {Number(params.nouvelles ?? 0) > 1 ? "s" : ""} évaluation
          {Number(params.nouvelles ?? 0) > 1 ? "s" : ""}.
        </div>
      ) : null}

      <section
        className="grid gap-3 sm:grid-cols-3"
        aria-label="Synthèse commerciale"
      >
        <Summary label="Opportunités évaluées" value={assessments.length} />
        <Summary label="Priorités fortes" value={highPriority} />
        <Summary label="Potentiel moyen" value={`${averageEstimate}%`} />
      </section>

      {assessments.length === 0 ? (
        <section className="rounded-lg border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
          <CircleGauge className="mx-auto text-slate-400" size={28} aria-hidden />
          <h2 className="mt-3 text-xl font-bold">Aucune évaluation disponible</h2>
          <p className="mt-1 text-sm text-slate-500">
            Les opportunités actives apparaîtront après la prochaine analyse.
          </p>
        </section>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2" aria-label="Évaluations commerciales">
          {assessments.map((assessment) => (
            <article key={assessment.id} className="rounded-lg bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <PriorityBadge priority={assessment.priority} />
                  <h2 className="mt-2 text-lg font-bold">{assessment.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {assessment.stageName} · {formatCurrency(assessment.valueCents)}
                  </p>
                </div>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                  v{assessment.version}
                </span>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                <Metric label="Suivi" value={`${assessment.score}%`} />
                <Metric label="Potentiel" value={`${assessment.closingEstimate}%`} />
                <Metric label="Confiance" value={`${assessment.confidence}%`} />
              </div>

              <div className="mt-5 grid gap-4 text-sm">
                <Detail label="Lecture" value={assessment.rationale} />
                <Detail label="Prochaine action recommandée" value={assessment.recommendedAction} />
                <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-amber-950">
                  <TriangleAlert className="mt-0.5 shrink-0" size={16} aria-hidden />
                  <p>{assessment.riskSummary}</p>
                </div>
              </div>

              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Preuves CRM
                </p>
                <ul className="mt-2 grid gap-2">
                  {assessment.evidence.map((evidence) => (
                    <li
                      key={evidence.id}
                      className="flex items-start justify-between gap-4 text-sm"
                    >
                      <span className="text-slate-600">{evidence.label}</span>
                      <span className="text-right font-semibold text-slate-800">
                        {evidence.observedValue}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <Link
                href={assessment.actionHref}
                className="mt-5 inline-flex items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white"
              >
                {assessment.actionLabel}
                <ArrowRight size={16} aria-hidden />
              </Link>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-white px-4 py-3 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l border-slate-200 first:border-l-0">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-semibold text-slate-900">{label}</p>
      <p className="mt-1 text-slate-600">{value}</p>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: SalesAiPriority }) {
  const labels: Record<SalesAiPriority, string> = {
    high: "Priorité forte",
    medium: "À surveiller",
    low: "Suivi normal",
  };
  const colors: Record<SalesAiPriority, string> = {
    high: "bg-rose-100 text-rose-800",
    medium: "bg-amber-100 text-amber-800",
    low: "bg-emerald-100 text-emerald-800",
  };
  return (
    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${colors[priority]}`}>
      {labels[priority]}
    </span>
  );
}

function formatCurrency(valueCents: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(valueCents / 100);
}
