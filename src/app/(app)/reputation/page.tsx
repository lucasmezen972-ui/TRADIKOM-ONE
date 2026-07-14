import {
  Check,
  FileSearch,
  RefreshCw,
  SendHorizontal,
  ShieldCheck,
  Star,
  X,
} from "lucide-react";
import {
  createReputationReviewAction,
  decideReputationProposalAction,
  generateReputationProposalsAction,
  submitReputationProposalAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import type {
  ReputationRiskLevel,
  ReputationSentiment,
  ReputationSource,
} from "@/modules/reputation-ai";

export const dynamic = "force-dynamic";

type ReputationPageProps = {
  searchParams: Promise<{
    avisImporte?: string;
    analyse?: string;
    nouvelles?: string;
    soumise?: string;
    decision?: string;
  }>;
};

export default async function ReputationPage({
  searchParams,
}: ReputationPageProps) {
  const params = await searchParams;
  const { user, tenant, membership } = await requireTenantContext();
  const services = await getServices();
  const workspace = await services.getReputationWorkspace(user.id, tenant.id);
  const canManage = ["owner", "administrator", "manager"].includes(
    membership.role,
  );
  const pendingCount = workspace.proposals.filter(
    (proposal) => proposal.status === "pending_approval",
  ).length;
  const highRiskCount = workspace.proposals.filter(
    (proposal) => proposal.riskLevel === "high",
  ).length;

  return (
    <div className="grid gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Avis importés et réponses préparées
          </p>
          <h1 className="mt-1 text-4xl font-bold">Réputation</h1>
        </div>
        {canManage ? (
          <form action={generateReputationProposalsAction}>
            <button className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
              <RefreshCw size={18} aria-hidden />
              Analyser les avis
            </button>
          </form>
        ) : null}
      </header>

      <div className="flex items-start gap-3 rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
        <ShieldCheck className="mt-0.5 shrink-0" size={19} aria-hidden />
        <p>
          L&apos;analyse repose uniquement sur les avis importés. Elle ne vérifie pas
          leur authenticité et ne surveille aucune plateforme externe. Une
          approbation ne publie ni n&apos;envoie jamais la réponse.
        </p>
      </div>

      {params.avisImporte || params.analyse || params.soumise || params.decision ? (
        <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">
          <Check size={18} aria-hidden />
          {params.avisImporte
            ? "Avis importé sans accès à une plateforme externe."
            : params.analyse
              ? `Analyse terminée : ${Number(params.nouvelles ?? 0)} nouvelle(s) proposition(s).`
              : params.soumise
                ? "Proposition transmise pour décision."
                : params.decision === "approved"
                  ? "Proposition approuvée, sans publication."
                  : "Proposition rejetée."}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Synthèse réputation">
        <Summary label="Avis importés" value={workspace.reviews.length} />
        <Summary label="Risques élevés" value={highRiskCount} />
        <Summary label="Décisions en attente" value={pendingCount} />
      </section>

      {canManage ? (
        <section className="grid gap-4 border-y border-slate-200 py-6">
          <div>
            <h2 className="text-xl font-bold">Importer un avis</h2>
            <p className="mt-1 text-sm text-slate-500">
              Saisie manuelle ou reprise contrôlée d&apos;un avis déjà reçu.
            </p>
          </div>
          <form action={createReputationReviewAction} className="grid gap-4 lg:grid-cols-2">
            <Field label="Source déclarée">
              <select name="source" required className={inputClassName}>
                {sourceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date de l'avis">
              <input
                name="occurredAt"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className={inputClassName}
              />
            </Field>
            <Field label="Nom affiché, facultatif">
              <input name="reviewerAlias" maxLength={100} className={inputClassName} />
            </Field>
            <Field label="Référence externe, facultative">
              <input name="externalRef" maxLength={200} className={inputClassName} />
            </Field>
            <Field label="Note, facultative">
              <select name="rating" className={inputClassName} defaultValue="">
                <option value="">Non renseignée</option>
                {[1, 2, 3, 4, 5].map((rating) => (
                  <option key={rating} value={rating}>{rating}/5</option>
                ))}
              </select>
            </Field>
            <div className="lg:col-span-2">
              <Field label="Texte de l'avis">
                <textarea
                  name="reviewText"
                  required
                  minLength={3}
                  maxLength={3000}
                  rows={4}
                  className={inputClassName}
                />
              </Field>
            </div>
            <button className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
              <FileSearch size={18} aria-hidden />
              Importer l&apos;avis
            </button>
          </form>
        </section>
      ) : null}

      <section className="grid gap-4">
        <div>
          <h2 className="text-xl font-bold">Boîte de réception</h2>
          <p className="mt-1 text-sm text-slate-500">
            Avis conservés comme preuves immuables dans cette organisation.
          </p>
        </div>
        {workspace.reviews.length === 0 ? (
          <EmptyState
            title="Aucun avis importé"
            description="Les avis saisis manuellement apparaîtront ici."
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {workspace.reviews.map((review) => (
              <article key={review.id} className="rounded-lg bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{sourceLabel(review.source)}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {review.reviewerAlias ?? "Auteur non renseigné"} · {formatDate(review.occurredAt)}
                    </p>
                  </div>
                  <Rating value={review.rating} />
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">
                  {review.reviewText}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4">
        <div>
          <h2 className="text-xl font-bold">Propositions de réponse</h2>
          <p className="mt-1 text-sm text-slate-500">
            Brouillons traçables à examiner avant toute utilisation hors de TRADIKOM ONE.
          </p>
        </div>
        {workspace.proposals.length === 0 ? (
          <EmptyState
            title="Aucune proposition disponible"
            description="Lancez l'analyse après avoir importé au moins un avis."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {workspace.proposals.map((proposal) => (
              <article key={proposal.id} className="rounded-lg bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    <SentimentBadge sentiment={proposal.sentiment} />
                    <RiskBadge risk={proposal.riskLevel} />
                    <StatusBadge status={proposal.status} />
                  </div>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                    v{proposal.version}
                  </span>
                </div>

                <p className="mt-4 line-clamp-3 text-sm italic text-slate-600">
                  « {proposal.reviewText} »
                </p>
                <div className="mt-5 grid gap-4 text-sm">
                  <Detail label="Lecture" value={proposal.rationale} />
                  <Detail label="Brouillon de réponse" value={proposal.responseDraft} />
                  <Detail label="Plan d'amélioration interne" value={proposal.improvementPlan} />
                  <Detail
                    label="Authenticité"
                    value="Non évaluée : aucune identité ni origine externe n'est vérifiée."
                  />
                </div>

                <div className="mt-5 border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Preuves utilisées
                  </p>
                  <ul className="mt-2 grid gap-2">
                    {proposal.evidence.map((evidence) => (
                      <li key={evidence.id} className="flex items-start justify-between gap-4 text-sm">
                        <span className="text-slate-600">{evidence.label}</span>
                        <span className="text-right font-semibold text-slate-800">
                          {evidence.observedValue}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {proposal.decisionReason ? (
                  <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    Motif de décision : {proposal.decisionReason}
                  </p>
                ) : null}

                {canManage && proposal.status === "proposed" ? (
                  <form action={submitReputationProposalAction} className="mt-5">
                    <input type="hidden" name="proposalId" value={proposal.id} />
                    <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white">
                      <SendHorizontal size={16} aria-hidden />
                      Soumettre pour décision
                    </button>
                  </form>
                ) : null}

                {canManage && proposal.status === "pending_approval" ? (
                  <form action={decideReputationProposalAction} className="mt-5 grid gap-3">
                    <input type="hidden" name="proposalId" value={proposal.id} />
                    <label className="text-sm font-semibold" htmlFor={`reason-${proposal.id}`}>
                      Motif de décision
                    </label>
                    <textarea
                      id={`reason-${proposal.id}`}
                      name="reason"
                      required
                      minLength={5}
                      maxLength={500}
                      rows={2}
                      className={inputClassName}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        name="decision"
                        value="approved"
                        className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
                      >
                        <Check size={16} aria-hidden />
                        Approuver sans publier
                      </button>
                      <button
                        name="decision"
                        value="rejected"
                        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-800"
                      >
                        <X size={16} aria-hidden />
                        Rejeter
                      </button>
                    </div>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const inputClassName =
  "mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950";

const sourceOptions: Array<{ value: ReputationSource; label: string }> = [
  { value: "manual_import", label: "Import manuel" },
  { value: "direct_feedback", label: "Retour direct" },
  { value: "google", label: "Google" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "tripadvisor", label: "Tripadvisor" },
  { value: "trustpilot", label: "Trustpilot" },
  { value: "industry_directory", label: "Annuaire métier" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-sm font-semibold text-slate-800">
      {label}
      {children}
    </label>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white px-4 py-3 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
      <Star className="mx-auto text-slate-400" size={27} aria-hidden />
      <h3 className="mt-3 text-lg font-bold">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-semibold text-slate-900">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-slate-600">{value}</p>
    </div>
  );
}

function Rating({ value }: { value?: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
      <Star size={14} aria-hidden />
      {value ? `${value}/5` : "Sans note"}
    </span>
  );
}

function SentimentBadge({ sentiment }: { sentiment: ReputationSentiment }) {
  const labels: Record<ReputationSentiment, string> = {
    positive: "Positif",
    neutral: "Neutre",
    negative: "Négatif",
  };
  return (
    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-800">
      {labels[sentiment]}
    </span>
  );
}

function RiskBadge({ risk }: { risk: ReputationRiskLevel }) {
  const labels: Record<ReputationRiskLevel, string> = {
    low: "Risque faible",
    medium: "Risque moyen",
    high: "Risque élevé",
  };
  const colors: Record<ReputationRiskLevel, string> = {
    low: "bg-emerald-100 text-emerald-800",
    medium: "bg-amber-100 text-amber-800",
    high: "bg-rose-100 text-rose-800",
  };
  return <span className={`rounded-md px-2 py-1 text-xs font-semibold ${colors[risk]}`}>{labels[risk]}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    proposed: "Brouillon",
    pending_approval: "Décision requise",
    approved: "Approuvée, non publiée",
    rejected: "Rejetée",
  };
  return (
    <span className="rounded-md bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-900">
      {labels[status] ?? status}
    </span>
  );
}

function sourceLabel(source: ReputationSource) {
  return sourceOptions.find((option) => option.value === source)?.label ?? source;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
    new Date(value),
  );
}
