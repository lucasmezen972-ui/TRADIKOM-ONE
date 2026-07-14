import {
  Check,
  FilePenLine,
  Mail,
  Megaphone,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  decideMarketingProposalAction,
  generateMarketingProposalsAction,
  reviseMarketingProposalAction,
  submitMarketingProposalAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import type { getAutonomousMarketing } from "@/modules/autonomous-marketing";

export const dynamic = "force-dynamic";

type MarketingProposal = Awaited<ReturnType<typeof getAutonomousMarketing>>[number];

type MarketingPageProps = {
  searchParams: Promise<{
    generation?: string;
    nouvelles?: string;
    soumission?: string;
    revision?: string;
    decision?: "approved" | "rejected";
  }>;
};

export default async function MarketingPage({ searchParams }: MarketingPageProps) {
  const params = await searchParams;
  const { user, tenant, membership } = await requireTenantContext();
  const services = await getServices();
  const proposals = await services.getAutonomousMarketing(user.id, tenant.id);
  const canManage = ["owner", "administrator", "manager"].includes(
    membership.role,
  );

  return (
    <div className="grid gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Campagnes contrôlées
          </p>
          <h1 className="mt-1 text-4xl font-bold">Marketing autonome</h1>
        </div>
        {canManage ? (
          <form action={generateMarketingProposalsAction}>
            <button className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
              <RefreshCw size={18} aria-hidden />
              Préparer les brouillons
            </button>
          </form>
        ) : null}
      </header>

      <div className="flex items-start gap-3 rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
        <ShieldCheck className="mt-0.5 shrink-0" size={19} aria-hidden />
        <p>
          <strong>Mode brouillon.</strong> Une approbation valide le contenu pour
          planification. Elle ne déclenche aucun envoi, aucune publication et
          aucune écriture externe.
        </p>
      </div>

      {params.generation ? (
        <Notice>
          Génération terminée : {Number(params.nouvelles ?? 0)} nouveau
          {Number(params.nouvelles ?? 0) > 1 ? "x" : ""} brouillon
          {Number(params.nouvelles ?? 0) > 1 ? "s" : ""}.
        </Notice>
      ) : null}
      {params.soumission ? <Notice>Brouillon soumis à approbation.</Notice> : null}
      {params.revision ? <Notice>Nouvelle version enregistrée en brouillon.</Notice> : null}
      {params.decision ? (
        <Notice>
          Proposition {params.decision === "approved" ? "approuvée" : "rejetée"}.
        </Notice>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Synthèse marketing">
        <Summary
          label="Brouillons"
          value={proposals.filter((item) => item.status === "draft").length}
        />
        <Summary
          label="À approuver"
          value={proposals.filter((item) => item.status === "pending_approval").length}
        />
        <Summary
          label="Approuvées"
          value={proposals.filter((item) => item.status === "approved").length}
        />
      </section>

      {proposals.length === 0 ? (
        <section className="rounded-lg border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
          <Megaphone className="mx-auto text-slate-400" size={28} aria-hidden />
          <h2 className="mt-3 text-xl font-bold">Aucun brouillon disponible</h2>
          <p className="mt-1 text-sm text-slate-500">
            Le Business Twin doit contenir une offre et un public cible vérifiés.
          </p>
        </section>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2" aria-label="Propositions marketing">
          {proposals.map((proposal) => (
            <article key={proposal.id} className="rounded-lg bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <StatusBadge status={proposal.status} />
                  <h2 className="mt-2 text-xl font-bold">{proposal.title}</h2>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                  {proposal.channel === "email" ? (
                    <Mail size={14} aria-hidden />
                  ) : (
                    <Megaphone size={14} aria-hidden />
                  )}
                  {proposal.channel === "email" ? "Email" : "Réseaux sociaux"}
                </span>
              </div>

              <div className="mt-4 grid gap-4 text-sm">
                {proposal.subject ? <Detail label="Objet" value={proposal.subject} /> : null}
                <Detail label="Objectif" value={proposal.objective} />
                <Detail label="Public" value={proposal.audience} />
                <Detail label="Contenu proposé" value={proposal.content} preserveLines />
                <Detail label="Appel à l'action" value={proposal.callToAction} />
                <Detail label="Résultat attendu" value={proposal.expectedOutcome} />
                <Detail label="Risques" value={proposal.riskSummary} />
              </div>

              <div className="mt-5 border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Preuves vérifiées
                  </p>
                  <span className="text-xs text-slate-500">Version {proposal.version}</span>
                </div>
                <ul className="mt-2 grid gap-2">
                  {proposal.evidence.map((evidence) => (
                    <li key={evidence.id} className="text-sm">
                      <span className="font-semibold text-slate-800">{evidence.label} : </span>
                      <span className="text-slate-600">{evidence.observedValue}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {proposal.status === "draft" && canManage ? (
                <form action={submitMarketingProposalAction} className="mt-5">
                  <input type="hidden" name="proposalId" value={proposal.id} />
                  <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white">
                    <Send size={16} aria-hidden />
                    Soumettre à approbation
                  </button>
                </form>
              ) : null}

              {proposal.status === "pending_approval" && canManage ? (
                <form action={decideMarketingProposalAction} className="mt-5 grid gap-3 border-t border-slate-100 pt-4">
                  <input type="hidden" name="proposalId" value={proposal.id} />
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
                      className="inline-flex min-h-10 items-center gap-2 rounded-md border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-800"
                    >
                      <X size={16} aria-hidden />
                      Rejeter
                    </button>
                  </div>
                </form>
              ) : null}

              {proposal.status === "approved" ? (
                <p className="mt-5 rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">
                  Contenu approuvé pour planification. Aucune diffusion automatique.
                </p>
              ) : null}

              {canManage && proposal.status !== "pending_approval" ? (
                <details className="mt-5 border-t border-slate-100 pt-4">
                  <summary className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800">
                    <FilePenLine size={16} aria-hidden />
                    Créer une nouvelle version
                  </summary>
                  <RevisionForm proposal={proposal} />
                </details>
              ) : null}

              {proposal.decisionReason ? (
                <p className="mt-4 text-sm text-slate-600">
                  <strong className="text-slate-800">Décision : </strong>
                  {proposal.decisionReason}
                </p>
              ) : null}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function RevisionForm({
  proposal,
}: {
  proposal: MarketingProposal;
}) {
  return (
    <form action={reviseMarketingProposalAction} className="mt-4 grid gap-3">
      <input type="hidden" name="proposalId" value={proposal.id} />
      <Field label="Titre" name="title" value={proposal.title} />
      {proposal.channel === "email" ? (
        <Field label="Objet" name="subject" value={proposal.subject} />
      ) : (
        <input type="hidden" name="subject" value="" />
      )}
      <Field label="Objectif" name="objective" value={proposal.objective} multiline />
      <Field label="Public" name="audience" value={proposal.audience} multiline />
      <Field label="Contenu" name="content" value={proposal.content} multiline />
      <Field label="Appel à l'action" name="callToAction" value={proposal.callToAction} />
      <Field
        label="Résultat attendu"
        name="expectedOutcome"
        value={proposal.expectedOutcome}
        multiline
      />
      <Field label="Risques" name="riskSummary" value={proposal.riskSummary} multiline />
      <button className="inline-flex min-h-10 w-fit items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
        <FilePenLine size={16} aria-hidden />
        Enregistrer la nouvelle version
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  value,
  multiline = false,
}: {
  label: string;
  name: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-slate-700">
      {label}
      {multiline ? (
        <textarea
          required
          name={name}
          defaultValue={value}
          rows={3}
          className="rounded-md border border-slate-200 px-3 py-2 font-normal"
        />
      ) : (
        <input
          required
          name={name}
          defaultValue={value}
          className="min-h-10 rounded-md border border-slate-200 px-3 py-2 font-normal"
        />
      )}
    </label>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">
      <Check size={18} aria-hidden />
      {children}
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

function Detail({
  label,
  value,
  preserveLines = false,
}: {
  label: string;
  value: string;
  preserveLines?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className={`mt-1 leading-6 text-slate-700 ${preserveLines ? "whitespace-pre-line" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "draft" | "pending_approval" | "approved" | "rejected" | "superseded" | "archived";
}) {
  const labels = {
    draft: "Brouillon",
    pending_approval: "À approuver",
    approved: "Approuvée pour planification",
    rejected: "Rejetée",
    superseded: "Remplacée",
    archived: "Archivée",
  };
  const styles = {
    draft: "bg-slate-100 text-slate-800",
    pending_approval: "bg-amber-100 text-amber-900",
    approved: "bg-emerald-100 text-emerald-900",
    rejected: "bg-rose-100 text-rose-900",
    superseded: "bg-slate-100 text-slate-700",
    archived: "bg-slate-100 text-slate-700",
  };
  return (
    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
