import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  History,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  decideCompetitorInsightAction,
  decideMarketingProposalAction,
  decideReputationProposalAction,
  decideStrategicRecommendationAction,
  decideWebsiteAiProposalAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import type { ApprovalCenterDecision, ApprovalCenterItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const decisionActions = {
  strategic: decideStrategicRecommendationAction,
  marketing: decideMarketingProposalAction,
  website_ai: decideWebsiteAiProposalAction,
  reputation: decideReputationProposalAction,
  competitor: decideCompetitorInsightAction,
} as const;

type ValidationsPageProps = {
  searchParams: Promise<{ decision?: string; iaDecision?: string }>;
};

export default async function ValidationsPage({
  searchParams,
}: ValidationsPageProps) {
  const params = await searchParams;
  const lastDecision = params.decision ?? params.iaDecision;
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const center = await services.getApprovalCenter(user.id, tenant.id);

  return (
    <div className="grid gap-8">
      <header className="border-b border-slate-300 pb-6">
        <p className="text-sm font-semibold uppercase text-[#0b8f84]">
          Validation humaine
        </p>
        <h1 className="mt-1 text-4xl font-bold text-slate-950">
          Actions à valider
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          TRADIKOM ONE prépare des actions mais n&apos;en exécute aucune sans
          votre accord. Chaque proposition indique ce qui a été détecté, le
          gain attendu et les risques.
        </p>
      </header>

      {lastDecision ? (
        <div
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
            lastDecision === "approved"
              ? "border-emerald-300 bg-emerald-50"
              : "border-slate-300 bg-slate-50"
          }`}
          role="status"
        >
          {lastDecision === "approved" ? (
            <CheckCircle2 size={20} className="mt-0.5 text-emerald-700" aria-hidden />
          ) : (
            <XCircle size={20} className="mt-0.5 text-slate-600" aria-hidden />
          )}
          <p className="text-sm font-semibold text-slate-800">
            {lastDecision === "approved"
              ? "Action approuvée. Elle est enregistrée dans l'historique ci-dessous."
              : "Action refusée. Elle ne sera pas exécutée."}
          </p>
        </div>
      ) : null}

      {!center.canApprove ? (
        <section className="rounded-lg border border-dashed border-slate-300 px-5 py-8 text-center">
          <ShieldCheck size={26} className="mx-auto text-slate-400" aria-hidden />
          <p className="mt-3 font-semibold text-slate-700">
            Votre rôle ne permet pas de valider ces actions.
          </p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">
            Seuls les propriétaires, administrateurs et responsables décident
            des actions préparées. Demandez à un responsable de votre
            organisation de les examiner.
          </p>
        </section>
      ) : (
        <section aria-labelledby="pending-title">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="pending-title" className="text-2xl font-bold">
                En attente de votre décision
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {center.pending.length === 0
                  ? "Aucune action ne vous attend."
                  : `${center.pending.length} action${center.pending.length > 1 ? "s" : ""} préparée${center.pending.length > 1 ? "s" : ""}.`}
              </p>
            </div>
          </div>

          {center.pending.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 px-5 py-8 text-center">
              <CheckCircle2 size={26} className="mx-auto text-emerald-600" aria-hidden />
              <p className="mt-3 font-semibold text-slate-700">
                Rien à valider pour le moment.
              </p>
              <p className="mx-auto mt-1 max-w-xl text-sm text-slate-500">
                Les propositions apparaissent ici dès que le conseiller
                stratégique, le marketing, le site, la réputation ou la veille
                concurrentielle préparent une action pour votre entreprise.
              </p>
              <Link
                href="/conseiller-strategique"
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#0b8f84] underline-offset-4 hover:underline"
              >
                Ouvrir le conseiller stratégique
                <ArrowRight size={15} aria-hidden />
              </Link>
            </div>
          ) : (
            <ul className="grid gap-4">
              {center.pending.map((item) => (
                <li key={item.id}>
                  <PendingCard item={item} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {center.canApprove && center.history.length > 0 ? (
        <section className="border-t border-slate-300 pt-6" aria-labelledby="history-title">
          <div className="mb-4 flex items-center gap-2">
            <History size={20} className="text-slate-500" aria-hidden />
            <h2 id="history-title" className="text-2xl font-bold">
              Décisions récentes
            </h2>
          </div>
          <ul className="grid gap-3">
            {center.history.map((entry) => (
              <li key={`${entry.kind}:${entry.id}`}>
                <HistoryRow entry={entry} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function PendingCard({ item }: { item: ApprovalCenterItem }) {
  const action = decisionActions[item.kind];

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {item.kindLabel}
          </span>
          <h3 className="mt-2 text-lg font-bold text-slate-950">{item.title}</h3>
          <p className="mt-1 text-xs text-slate-500">
            Préparée le {formatDate(item.requestedAt)}
          </p>
        </div>
        {item.confidence !== null ? (
          <span className="shrink-0 rounded-md bg-[#0b8f84]/10 px-3 py-1 text-sm font-semibold text-[#0b7c72]">
            Confiance {item.confidence} %
          </span>
        ) : null}
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <Detail label="Pourquoi" value={item.rationale} />
        <Detail label="Résultat attendu" value={item.expectedGain} />
        <Detail label="Points de vigilance" value={item.riskSummary} />
      </dl>

      <form action={action} className="mt-5 grid gap-3 border-t border-slate-100 pt-4">
        <input type="hidden" name={item.decisionField} value={item.targetId} />
        <input type="hidden" name="retour" value="/validations" />
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Motif de votre décision
          <input
            name="reason"
            required
            minLength={5}
            maxLength={500}
            placeholder="Expliquez votre choix en une phrase"
            className="rounded-md border border-slate-300 px-4 py-3 font-normal"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            name="decision"
            value="approved"
            className="inline-flex items-center gap-2 rounded-md bg-[#0b8f84] px-5 py-3 font-semibold text-white"
          >
            <CheckCircle2 size={17} aria-hidden />
            Approuver
          </button>
          <button
            type="submit"
            name="decision"
            value="rejected"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-800"
          >
            <XCircle size={17} aria-hidden />
            Refuser
          </button>
          <Link
            href={item.detailHref}
            className="inline-flex items-center gap-1 text-sm font-semibold text-[#0b8f84] underline-offset-4 hover:underline"
          >
            Voir le détail complet
            <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
      </form>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-slate-700">
        {value && value.trim().length > 0 ? value : "Non précisé"}
      </dd>
    </div>
  );
}

function HistoryRow({ entry }: { entry: ApprovalCenterDecision }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="font-semibold text-slate-900">{entry.title}</p>
        <p className="mt-1 text-sm text-slate-500">
          {entry.kindLabel} — {entry.reason}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <span
          className={`inline-block rounded-md px-2 py-1 text-xs font-semibold ${
            entry.decision === "approved"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-slate-100 text-slate-700"
          }`}
        >
          {entry.decision === "approved" ? "Approuvée" : "Refusée"}
        </span>
        <p className="mt-1 text-xs text-slate-500">
          {formatDate(entry.decidedAt)}
        </p>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "date inconnue";
  }
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(parsed);
}
