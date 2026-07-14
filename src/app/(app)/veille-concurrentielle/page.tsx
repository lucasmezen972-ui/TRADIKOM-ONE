import {
  Binoculars,
  Check,
  ExternalLink,
  FilePlus2,
  RefreshCw,
  SendHorizontal,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  createCompetitorObservationAction,
  createCompetitorProfileAction,
  decideCompetitorInsightAction,
  generateCompetitorInsightsAction,
  submitCompetitorInsightAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import type {
  CompetitorCategory,
  CompetitorDirection,
  CompetitorImpact,
  CompetitorSourceType,
} from "@/modules/competitor-intelligence";

export const dynamic = "force-dynamic";

type CompetitorIntelligencePageProps = {
  searchParams: Promise<{
    concurrentCree?: string;
    observationCreee?: string;
    analyse?: string;
    nouvelles?: string;
    soumise?: string;
    decision?: string;
  }>;
};

export default async function CompetitorIntelligencePage({
  searchParams,
}: CompetitorIntelligencePageProps) {
  const params = await searchParams;
  const { user, tenant, membership } = await requireTenantContext();
  const services = await getServices();
  const workspace = await services.getCompetitorIntelligenceWorkspace(
    user.id,
    tenant.id,
  );
  const canManage = ["owner", "administrator", "manager"].includes(
    membership.role,
  );
  const riskCount = workspace.insights.filter(
    (insight) => insight.impact === "risk",
  ).length;
  const pendingCount = workspace.insights.filter(
    (insight) => insight.status === "pending_approval",
  ).length;
  const activeCompetitors = workspace.competitors.filter(
    (competitor) => competitor.status === "active",
  );

  return (
    <div className="grid gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Preuves publiques enregistrées manuellement
          </p>
          <h1 className="mt-1 text-4xl font-bold">Veille concurrentielle</h1>
        </div>
        {canManage && workspace.observations.length > 0 ? (
          <form action={generateCompetitorInsightsAction}>
            <button className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
              <RefreshCw size={18} aria-hidden />
              Comparer les observations
            </button>
          </form>
        ) : null}
      </header>

      <div className="flex items-start gap-3 rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
        <ShieldCheck className="mt-0.5 shrink-0" size={19} aria-hidden />
        <p>
          TRADIKOM ONE n&apos;ouvre aucune URL et ne collecte aucune donnée dans cet
          espace. Seules les observations de sources publiques légales que vous
          confirmez sont comparées; aucune réaction externe n&apos;est exécutée.
        </p>
      </div>

      {hasConfirmation(params) ? (
        <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">
          <Check size={18} aria-hidden />
          {confirmationMessage(params)}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Synthèse de veille">
        <Summary label="Concurrents actifs" value={activeCompetitors.length} />
        <Summary label="Risques à examiner" value={riskCount} />
        <Summary label="Décisions en attente" value={pendingCount} />
      </section>

      {canManage ? (
        <section className="grid gap-5 border-y border-slate-200 py-6 lg:grid-cols-2">
          <div className="grid content-start gap-4">
            <div>
              <h2 className="text-xl font-bold">Ajouter un concurrent</h2>
              <p className="mt-1 text-sm text-slate-500">
                Le site sert de référence uniquement; il n&apos;est jamais consulté automatiquement.
              </p>
            </div>
            <form action={createCompetitorProfileAction} className="grid gap-4">
              <Field label="Nom du concurrent">
                <input name="name" required minLength={2} maxLength={120} className={inputClassName} />
              </Field>
              <Field label="Site public HTTPS, facultatif">
                <input name="websiteUrl" type="url" maxLength={500} className={inputClassName} />
              </Field>
              <button className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
                <FilePlus2 size={18} aria-hidden />
                Ajouter le concurrent
              </button>
            </form>
          </div>

          <div className="grid content-start gap-4">
            <div>
              <h2 className="text-xl font-bold">Enregistrer une observation</h2>
              <p className="mt-1 text-sm text-slate-500">
                Décrivez uniquement ce qui est visible publiquement et vérifiable.
              </p>
            </div>
            {activeCompetitors.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
                Ajoutez d&apos;abord un concurrent actif.
              </p>
            ) : (
              <form action={createCompetitorObservationAction} className="grid gap-4 sm:grid-cols-2">
                <Field label="Concurrent">
                  <select name="competitorId" required className={inputClassName}>
                    {activeCompetitors.map((competitor) => (
                      <option key={competitor.id} value={competitor.id}>{competitor.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Catégorie">
                  <select name="category" required className={inputClassName}>
                    {categoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Évolution déclarée">
                  <select name="direction" required className={inputClassName}>
                    {directionOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Type de source publique">
                  <select name="sourceType" required className={inputClassName}>
                    {sourceTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Date observée">
                  <input
                    name="observedAt"
                    type="date"
                    required
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    className={inputClassName}
                  />
                </Field>
                <Field label="URL publique HTTPS">
                  <input name="sourceUrl" type="url" required maxLength={500} className={inputClassName} />
                </Field>
                <Field label="Titre factuel">
                  <input name="title" required minLength={3} maxLength={160} className={inputClassName} />
                </Field>
                <Field label="Valeur observée, facultative">
                  <input name="observedValue" maxLength={300} className={inputClassName} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Résumé factuel">
                    <textarea
                      name="summary"
                      required
                      minLength={10}
                      maxLength={2000}
                      rows={4}
                      className={inputClassName}
                    />
                  </Field>
                </div>
                <label className="flex items-start gap-3 text-sm text-slate-700 sm:col-span-2">
                  <input name="publicSourceConfirmed" type="checkbox" required className="mt-1" />
                  Je confirme qu&apos;il s&apos;agit d&apos;une source publique légalement accessible.
                </label>
                <label className="flex items-start gap-3 text-sm text-slate-700 sm:col-span-2">
                  <input name="protectedContentExcluded" type="checkbox" required className="mt-1" />
                  Je n&apos;ai copié aucun contenu protégé, privé ou soumis à authentification.
                </label>
                <button className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white sm:col-span-2">
                  <FilePlus2 size={18} aria-hidden />
                  Enregistrer l&apos;observation
                </button>
              </form>
            )}
          </div>
        </section>
      ) : null}

      <section className="grid gap-4">
        <div>
          <h2 className="text-xl font-bold">Observations publiques</h2>
          <p className="mt-1 text-sm text-slate-500">
            Historique immuable des faits saisis par votre équipe.
          </p>
        </div>
        {workspace.observations.length === 0 ? (
          <EmptyState
            title="Aucune observation"
            description="Les faits publics confirmés apparaîtront ici."
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {workspace.observations.map((observation) => (
              <article key={observation.id} className="rounded-lg bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                      {observation.competitorName} · {categoryLabel(observation.category)}
                    </p>
                    <h3 className="mt-2 text-lg font-bold">{observation.title}</h3>
                  </div>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-800">
                    {directionLabel(observation.direction)}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                  {observation.summary}
                </p>
                {observation.observedValue ? (
                  <p className="mt-3 text-sm font-semibold text-slate-800">
                    Valeur observée : {observation.observedValue}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="text-slate-500">{formatDate(observation.observedAt)}</span>
                  <a
                    href={observation.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 font-semibold text-teal-800"
                  >
                    Ouvrir la preuve publique
                    <ExternalLink size={15} aria-hidden />
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4">
        <div>
          <h2 className="text-xl font-bold">Analyses proposées</h2>
          <p className="mt-1 text-sm text-slate-500">
            Comparaisons internes à valider, sans réaction automatique.
          </p>
        </div>
        {workspace.insights.length === 0 ? (
          <EmptyState
            title="Aucune analyse disponible"
            description="Enregistrez une observation puis lancez la comparaison."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {workspace.insights.map((insight) => (
              <article key={insight.id} className="rounded-lg bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <ImpactBadge impact={insight.impact} />
                    <h3 className="mt-2 text-lg font-bold">{insight.title}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Confiance {insight.confidence}% · v{insight.version}
                    </p>
                  </div>
                  <StatusBadge status={insight.status} />
                </div>
                <div className="mt-5 grid gap-4 text-sm">
                  <Detail label="Lecture" value={insight.rationale} />
                  <Detail label="Action interne recommandée" value={insight.recommendedAction} />
                  <Detail label="Dernier fait" value={insight.observationSummary} />
                </div>
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Preuves comparées
                  </p>
                  <ul className="mt-2 grid gap-2">
                    {insight.evidence.map((evidence) => (
                      <li key={evidence.id} className="flex items-start justify-between gap-4 text-sm">
                        <span className="text-slate-600">{evidence.label}</span>
                        <span className="text-right font-semibold text-slate-800">
                          {evidence.observedValue}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                {insight.decisionReason ? (
                  <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    Motif de décision : {insight.decisionReason}
                  </p>
                ) : null}
                {canManage && insight.status === "proposed" ? (
                  <form action={submitCompetitorInsightAction} className="mt-5">
                    <input type="hidden" name="insightId" value={insight.id} />
                    <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white">
                      <SendHorizontal size={16} aria-hidden />
                      Soumettre pour décision
                    </button>
                  </form>
                ) : null}
                {canManage && insight.status === "pending_approval" ? (
                  <form action={decideCompetitorInsightAction} className="mt-5 grid gap-3">
                    <input type="hidden" name="insightId" value={insight.id} />
                    <label className="text-sm font-semibold" htmlFor={`decision-${insight.id}`}>
                      Motif de décision
                    </label>
                    <textarea
                      id={`decision-${insight.id}`}
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
                        Approuver pour planification
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

const categoryOptions: Array<{ value: CompetitorCategory; label: string }> = [
  { value: "price", label: "Prix" },
  { value: "website", label: "Site web" },
  { value: "seo", label: "Référencement" },
  { value: "service", label: "Service" },
  { value: "product", label: "Produit" },
  { value: "google_position", label: "Position Google" },
  { value: "advertising", label: "Publicité" },
  { value: "social_activity", label: "Activité sociale" },
  { value: "review", label: "Avis publics" },
  { value: "opening_hours", label: "Horaires" },
  { value: "job", label: "Recrutement" },
  { value: "partnership", label: "Partenariat" },
];

const directionOptions: Array<{ value: CompetitorDirection; label: string }> = [
  { value: "changed", label: "Changement" },
  { value: "increase", label: "Hausse" },
  { value: "decrease", label: "Baisse" },
  { value: "new", label: "Nouveauté" },
  { value: "removed", label: "Retrait" },
  { value: "positive_signal", label: "Signal positif" },
  { value: "negative_signal", label: "Signal négatif" },
];

const sourceTypeOptions: Array<{ value: CompetitorSourceType; label: string }> = [
  { value: "official_website", label: "Site officiel" },
  { value: "public_search", label: "Résultat public de recherche" },
  { value: "public_social", label: "Publication sociale publique" },
  { value: "public_directory", label: "Annuaire public" },
  { value: "public_ad", label: "Publicité publique" },
  { value: "public_job", label: "Offre d'emploi publique" },
  { value: "public_review", label: "Avis public" },
  { value: "public_announcement", label: "Annonce publique" },
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
      <Binoculars className="mx-auto text-slate-400" size={28} aria-hidden />
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

function ImpactBadge({ impact }: { impact: CompetitorImpact }) {
  const labels: Record<CompetitorImpact, string> = {
    opportunity: "Opportunité à vérifier",
    risk: "Risque à examiner",
    watch: "À surveiller",
  };
  const colors: Record<CompetitorImpact, string> = {
    opportunity: "bg-emerald-100 text-emerald-800",
    risk: "bg-rose-100 text-rose-800",
    watch: "bg-amber-100 text-amber-800",
  };
  return <span className={`rounded-md px-2 py-1 text-xs font-semibold ${colors[impact]}`}>{labels[impact]}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    proposed: "Analyse proposée",
    pending_approval: "Décision requise",
    approved: "Approuvée pour planification",
    rejected: "Rejetée",
  };
  return (
    <span className="rounded-md bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-900">
      {labels[status] ?? status}
    </span>
  );
}

function categoryLabel(category: CompetitorCategory) {
  return categoryOptions.find((option) => option.value === category)?.label ?? category;
}

function directionLabel(direction: CompetitorDirection) {
  return directionOptions.find((option) => option.value === direction)?.label ?? direction;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function hasConfirmation(params: Awaited<CompetitorIntelligencePageProps["searchParams"]>) {
  return Boolean(
    params.concurrentCree ||
      params.observationCreee ||
      params.analyse ||
      params.soumise ||
      params.decision,
  );
}

function confirmationMessage(
  params: Awaited<CompetitorIntelligencePageProps["searchParams"]>,
) {
  if (params.concurrentCree) return "Concurrent ajouté sans collecte externe.";
  if (params.observationCreee) return "Observation publique enregistrée.";
  if (params.analyse) {
    return `Comparaison terminée : ${Number(params.nouvelles ?? 0)} nouvelle(s) analyse(s).`;
  }
  if (params.soumise) return "Analyse transmise pour décision.";
  return params.decision === "approved"
    ? "Analyse approuvée pour planification uniquement."
    : "Analyse rejetée.";
}
