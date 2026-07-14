import Link from "next/link";
import {
  ArrowRight,
  Check,
  Lightbulb,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  decideStrategicRecommendationAction,
  generateStrategicRecommendationsAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import type {
  StrategicAdvisorRole,
  StrategicEffort,
} from "@/modules/strategic-advisor";

export const dynamic = "force-dynamic";

const roles: Array<{ value: StrategicAdvisorRole; label: string }> = [
  { value: "executive", label: "Direction" },
  { value: "marketing", label: "Marketing" },
  { value: "sales", label: "Ventes" },
  { value: "operations", label: "Opérations" },
  { value: "finance", label: "Finance" },
  { value: "reputation", label: "Réputation" },
  { value: "technology", label: "Technologie" },
];

type StrategicAdvisorPageProps = {
  searchParams: Promise<{
    analyse?: string;
    nouvelles?: string;
    decision?: "approved" | "rejected";
  }>;
};

export default async function StrategicAdvisorPage({
  searchParams,
}: StrategicAdvisorPageProps) {
  const params = await searchParams;
  const { user, tenant, membership } = await requireTenantContext();
  const services = await getServices();
  const recommendations = await services.getStrategicAdvisor(
    user.id,
    tenant.id,
  );
  const canDecide = ["owner", "administrator", "manager"].includes(
    membership.role,
  );
  const proposed = recommendations.filter((item) => item.status === "proposed");

  return (
    <div className="grid gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Aide à la décision
          </p>
          <h1 className="mt-1 text-4xl font-bold">Conseiller stratégique</h1>
        </div>
        {canDecide ? (
          <form action={generateStrategicRecommendationsAction}>
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
          <strong>Mode proposition.</strong> Une approbation valide une orientation
          pour planification. Elle ne lance aucune campagne, aucun message, aucun
          connecteur et aucune écriture externe.
        </p>
      </div>

      {params.analyse ? (
        <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">
          <Check size={18} aria-hidden />
          Analyse terminée : {Number(params.nouvelles ?? 0)} nouvelle
          {Number(params.nouvelles ?? 0) > 1 ? "s" : ""} proposition
          {Number(params.nouvelles ?? 0) > 1 ? "s" : ""}.
        </div>
      ) : null}
      {params.decision ? (
        <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">
          <Check size={18} aria-hidden />
          Recommandation {params.decision === "approved" ? "approuvée" : "rejetée"}.
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Synthèse des recommandations">
        <Summary label="À décider" value={proposed.length} />
        <Summary
          label="Approuvées"
          value={recommendations.filter((item) => item.status === "approved").length}
        />
        <Summary
          label="Rejetées"
          value={recommendations.filter((item) => item.status === "rejected").length}
        />
      </section>

      {recommendations.length === 0 ? (
        <section className="rounded-lg border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
          <Lightbulb className="mx-auto text-slate-400" size={28} aria-hidden />
          <h2 className="mt-3 text-xl font-bold">Aucune recommandation disponible</h2>
          <p className="mt-1 text-sm text-slate-500">
            L&apos;analyse attend des signaux vérifiés du Cerveau d&apos;entreprise.
          </p>
        </section>
      ) : (
        roles.map((role) => {
          const items = recommendations.filter(
            (recommendation) => recommendation.role === role.value,
          );
          if (items.length === 0) return null;
          return (
            <section key={role.value} aria-labelledby={`role-${role.value}`}>
              <h2 id={`role-${role.value}`} className="mb-3 text-xl font-bold">
                {role.label}
              </h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {items.map((recommendation) => (
                  <article
                    key={recommendation.id}
                    className="rounded-lg bg-white p-5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <StatusBadge status={recommendation.status} />
                        <h3 className="mt-2 text-lg font-bold">
                          {recommendation.title}
                        </h3>
                      </div>
                      <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                        {recommendation.confidence}%
                      </span>
                    </div>

                    <div className="mt-4 grid gap-4 text-sm">
                      <AdvisorDetail label="Pourquoi" value={recommendation.rationale} />
                      <AdvisorDetail
                        label="Gain attendu"
                        value={recommendation.expectedGain}
                      />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <AdvisorDetail
                          label="Effort"
                          value={effortLabel(recommendation.effort)}
                        />
                        <AdvisorDetail label="ROI" value={recommendation.roiSummary} />
                      </div>
                      <AdvisorDetail label="Risques" value={recommendation.riskSummary} />
                    </div>

                    <div className="mt-5 border-t border-slate-100 pt-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                        Preuves
                      </p>
                      <ul className="mt-2 grid gap-2">
                        {recommendation.evidence.map((evidence) => (
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
                      href={recommendation.actionHref}
                      className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      {recommendation.actionLabel}
                      <ArrowRight size={16} aria-hidden />
                    </Link>

                    {recommendation.status === "proposed" && canDecide ? (
                      <form
                        action={decideStrategicRecommendationAction}
                        className="mt-5 grid gap-3 border-t border-slate-100 pt-4"
                      >
                        <input
                          type="hidden"
                          name="recommendationId"
                          value={recommendation.id}
                        />
                        <label className="grid gap-1 text-sm font-semibold text-slate-700">
                          Motif de décision
                          <textarea
                            required
                            name="reason"
                            minLength={5}
                            maxLength={500}
                            rows={2}
                            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            name="decision"
                            value="approved"
                            className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
                          >
                            <Check size={16} aria-hidden />
                            Approuver pour planification
                          </button>
                          <button
                            name="decision"
                            value="rejected"
                            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-50"
                          >
                            <X size={16} aria-hidden />
                            Rejeter
                          </button>
                        </div>
                      </form>
                    ) : recommendation.decisionReason ? (
                      <div className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600">
                        <span className="font-semibold text-slate-800">Décision : </span>
                        {recommendation.decisionReason}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-h-24 rounded-lg bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

function AdvisorDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 leading-6 text-slate-700">{value}</p>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "proposed" | "approved" | "rejected" | "superseded" | "expired";
}) {
  const labels = {
    proposed: "À décider",
    approved: "Approuvée pour planification",
    rejected: "Rejetée",
    superseded: "Remplacée",
    expired: "Expirée",
  };
  const styles = {
    proposed: "bg-amber-100 text-amber-900",
    approved: "bg-emerald-100 text-emerald-900",
    rejected: "bg-rose-100 text-rose-900",
    superseded: "bg-slate-100 text-slate-700",
    expired: "bg-slate-100 text-slate-700",
  };
  return (
    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function effortLabel(effort: StrategicEffort) {
  if (effort === "low") return "Faible";
  if (effort === "medium") return "Moyen";
  return "Élevé";
}
