import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  applyWebsiteAiProposalAction,
  decideWebsiteAiProposalAction,
  generateWebsiteAiProposalsAction,
  moveSectionAction,
  publishWebsiteAction,
  restoreVersionAction,
  submitWebsiteAiProposalAction,
  updateSectionAction,
} from "@/app/actions";
import { SiteRenderer } from "@/components/site-renderer";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import type { getWebsiteAiWorkspace } from "@/modules/website-ai";

export const dynamic = "force-dynamic";

type WebsiteAiProposal = Awaited<ReturnType<typeof getWebsiteAiWorkspace>>[number];

type WebsitePageProps = {
  searchParams: Promise<{
    analyse?: string;
    nouvelles?: string;
    iaSoumise?: string;
    iaDecision?: "approved" | "rejected";
    iaApplication?: "applied" | "stale";
  }>;
};

export default async function WebsitePage({ searchParams }: WebsitePageProps) {
  const params = await searchParams;
  const { user, tenant, membership } = await requireTenantContext();
  const services = await getServices();
  const workspace = await services.getWebsiteWorkspace(user.id, tenant.id);
  const aiProposals = await services.getWebsiteAiWorkspace(user.id, tenant.id);
  const canManageAi = ["owner", "administrator", "manager"].includes(
    membership.role,
  );

  if (!workspace.website) {
    return (
      <div className="rounded-lg bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold">Aucun site genere</h1>
        <p className="mt-3 text-slate-600">
          Completez l&apos;onboarding pour creer un Business Twin et un premier site.
        </p>
        <Link
          href="/onboarding"
          className="mt-5 inline-flex rounded-md bg-[#08111f] px-4 py-3 font-semibold text-white"
        >
          Lancer l&apos;onboarding
        </Link>
      </div>
    );
  }

  const publicUrl = `/sites/${tenant.slug}`;

  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Website Factory
          </p>
          <h1 className="mt-1 text-4xl font-bold">{workspace.website.name}</h1>
          <p className="mt-2 text-slate-600">
            Statut : {workspace.website.status === "published" ? "publie" : "brouillon"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={publicUrl}
            className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-3 font-semibold shadow-sm"
          >
            <Eye size={18} aria-hidden />
            Voir le site
          </Link>
          <form action={publishWebsiteAction}>
            <button className="inline-flex items-center gap-2 rounded-md bg-[#08111f] px-4 py-3 font-semibold text-white">
              <Send size={18} aria-hidden />
              Publier
            </button>
          </form>
        </div>
      </header>

      <section className="grid gap-4 rounded-lg bg-white p-5 shadow-sm" aria-labelledby="website-ai-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
              Optimisation contrôlée
            </p>
            <h2 id="website-ai-title" className="mt-1 text-2xl font-bold">
              Website AI
            </h2>
          </div>
          {canManageAi ? (
            <form action={generateWebsiteAiProposalsAction}>
              <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white">
                <Sparkles size={17} aria-hidden />
                Analyser le brouillon
              </button>
            </form>
          ) : null}
        </div>

        <div className="flex items-start gap-3 rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
          <ShieldCheck className="mt-0.5 shrink-0" size={18} aria-hidden />
          <p>
            Chaque amélioration exige une approbation puis une application
            explicite. Elle crée une version de brouillon restaurable et ne publie
            jamais le site.
          </p>
        </div>

        {params.analyse ? (
          <WebsiteAiNotice>
            Analyse terminée : {Number(params.nouvelles ?? 0)} nouvelle
            {Number(params.nouvelles ?? 0) > 1 ? "s" : ""} proposition
            {Number(params.nouvelles ?? 0) > 1 ? "s" : ""}.
          </WebsiteAiNotice>
        ) : null}
        {params.iaSoumise ? (
          <WebsiteAiNotice>Proposition soumise à approbation.</WebsiteAiNotice>
        ) : null}
        {params.iaDecision ? (
          <WebsiteAiNotice>
            Proposition {params.iaDecision === "approved" ? "approuvée" : "rejetée"}.
          </WebsiteAiNotice>
        ) : null}
        {params.iaApplication ? (
          <WebsiteAiNotice>
            {params.iaApplication === "applied"
              ? "Amélioration appliquée au brouillon uniquement."
              : "Proposition devenue obsolète : le brouillon humain a été conservé."}
          </WebsiteAiNotice>
        ) : null}

        {aiProposals.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center">
            <Sparkles className="mx-auto text-slate-400" size={24} aria-hidden />
            <p className="mt-2 font-semibold">Aucune amélioration proposée</p>
            <p className="mt-1 text-sm text-slate-500">
              L&apos;analyse compare le brouillon aux informations vérifiées du Business Twin.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {aiProposals.map((proposal) => (
              <WebsiteAiProposalCard
                key={proposal.id}
                proposal={proposal}
                canManage={canManageAi}
              />
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="grid gap-4">
          {workspace.sections.map((section) => (
            <div key={section.id} className="rounded-lg bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                    {section.type}
                  </p>
                  <h2 className="text-lg font-bold">{section.title}</h2>
                </div>
                <div className="flex gap-2">
                  <form action={moveSectionAction}>
                    <input type="hidden" name="sectionId" value={section.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button
                      className="grid size-9 place-items-center rounded-md border border-slate-200"
                      aria-label="Monter la section"
                    >
                      <ArrowUp size={16} aria-hidden />
                    </button>
                  </form>
                  <form action={moveSectionAction}>
                    <input type="hidden" name="sectionId" value={section.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button
                      className="grid size-9 place-items-center rounded-md border border-slate-200"
                      aria-label="Descendre la section"
                    >
                      <ArrowDown size={16} aria-hidden />
                    </button>
                  </form>
                </div>
              </div>
              <form action={updateSectionAction} className="grid gap-3">
                <input type="hidden" name="sectionId" value={section.id} />
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" name="enabled" defaultChecked={section.enabled} />
                  Section active
                </label>
                <input
                  name="title"
                  defaultValue={section.title}
                  className="rounded-md border border-slate-200 px-3 py-2"
                />
                <textarea
                  name="body"
                  defaultValue={section.body}
                  rows={3}
                  className="rounded-md border border-slate-200 px-3 py-2"
                />
                <div className="grid gap-3 md:grid-cols-3">
                  <input
                    name="imageUrl"
                    defaultValue={section.imageUrl ?? ""}
                    placeholder="Image"
                    className="rounded-md border border-slate-200 px-3 py-2"
                  />
                  <input
                    name="buttonLabel"
                    defaultValue={section.buttonLabel ?? ""}
                    placeholder="Bouton"
                    className="rounded-md border border-slate-200 px-3 py-2"
                  />
                  <input
                    name="buttonHref"
                    defaultValue={section.buttonHref ?? ""}
                    placeholder="Lien"
                    className="rounded-md border border-slate-200 px-3 py-2"
                  />
                </div>
                <button className="inline-flex w-fit items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 font-semibold text-white">
                  <Save size={16} aria-hidden />
                  Enregistrer
                </button>
              </form>
            </div>
          ))}

          <div className="rounded-lg bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Versions</h2>
            <div className="mt-3 grid gap-2">
              {workspace.versions.map((version) => (
                <form
                  key={version.id}
                  action={restoreVersionAction}
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2"
                >
                  <input type="hidden" name="versionId" value={version.id} />
                  <span className="text-sm">
                    {version.source} - {new Date(version.created_at).toLocaleString("fr-FR")}
                  </span>
                  <button className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold">
                    <RotateCcw size={15} aria-hidden />
                    Restaurer
                  </button>
                </form>
              ))}
            </div>
          </div>
        </div>

        <aside className="grid gap-5">
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Apercu desktop</h2>
              <span className="text-sm text-slate-500">Brouillon</span>
            </div>
            <div className="max-h-[780px] overflow-auto rounded-md border border-slate-200">
              <SiteRenderer website={workspace.website} sections={workspace.sections} preview />
            </div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-bold">Apercu mobile</h2>
            <div className="mx-auto max-h-[680px] max-w-sm overflow-auto rounded-md border border-slate-200">
              <SiteRenderer website={workspace.website} sections={workspace.sections} preview />
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

function WebsiteAiProposalCard({
  proposal,
  canManage,
}: {
  proposal: WebsiteAiProposal;
  canManage: boolean;
}) {
  return (
    <article className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <WebsiteAiStatus status={proposal.status} />
          <h3 className="mt-2 text-lg font-bold">{proposal.title}</h3>
        </div>
        <span className="shrink-0 text-xs font-semibold text-slate-500">
          Version {proposal.version}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-700">{proposal.rationale}</p>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <WebsiteAiDetail label="Gain attendu" value={proposal.expectedGain} />
        <WebsiteAiDetail label="Risques" value={proposal.riskSummary} />
      </div>

      <div className="mt-4 rounded-md bg-slate-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Contenu proposé
        </p>
        <p className="mt-2 font-semibold text-slate-900">{proposal.proposedTitle}</p>
        <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-700">
          {proposal.proposedBody}
        </p>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Preuves
        </p>
        <ul className="mt-2 grid gap-1 text-sm text-slate-600">
          {proposal.evidence.map((evidence) => (
            <li key={evidence.id}>
              <strong className="text-slate-800">{evidence.label} :</strong>{" "}
              {evidence.observedValue}
            </li>
          ))}
        </ul>
      </div>

      {proposal.status === "proposed" && canManage ? (
        <form action={submitWebsiteAiProposalAction} className="mt-4">
          <input type="hidden" name="proposalId" value={proposal.id} />
          <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white">
            <Send size={16} aria-hidden />
            Soumettre à approbation
          </button>
        </form>
      ) : null}

      {proposal.status === "pending_approval" && canManage ? (
        <form action={decideWebsiteAiProposalAction} className="mt-4 grid gap-3 border-t border-slate-100 pt-4">
          <input type="hidden" name="proposalId" value={proposal.id} />
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Motif de décision Website AI
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
              Approuver le brouillon
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

      {proposal.status === "approved" && canManage ? (
        <form action={applyWebsiteAiProposalAction} className="mt-4">
          <input type="hidden" name="proposalId" value={proposal.id} />
          <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
            <Save size={16} aria-hidden />
            Appliquer au brouillon
          </button>
        </form>
      ) : null}

      {proposal.status === "applied" ? (
        <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">
          Appliquée au brouillon. Publication manuelle toujours requise.
        </p>
      ) : null}
      {proposal.status === "stale" ? (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          Proposition obsolète : une modification plus récente a été conservée.
        </p>
      ) : null}
      {proposal.decisionReason ? (
        <p className="mt-3 text-sm text-slate-600">
          <strong className="text-slate-800">Décision :</strong>{" "}
          {proposal.decisionReason}
        </p>
      ) : null}
    </article>
  );
}

function WebsiteAiDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 leading-6 text-slate-700">{value}</p>
    </div>
  );
}

function WebsiteAiNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-950">
      <Check size={17} aria-hidden />
      {children}
    </div>
  );
}

function WebsiteAiStatus({ status }: { status: WebsiteAiProposal["status"] }) {
  const labels = {
    proposed: "Proposée",
    pending_approval: "À approuver",
    approved: "Approuvée",
    rejected: "Rejetée",
    applied: "Appliquée au brouillon",
    superseded: "Remplacée",
    stale: "Obsolète",
  };
  const styles = {
    proposed: "bg-slate-100 text-slate-800",
    pending_approval: "bg-amber-100 text-amber-900",
    approved: "bg-emerald-100 text-emerald-900",
    rejected: "bg-rose-100 text-rose-900",
    applied: "bg-teal-100 text-teal-900",
    superseded: "bg-slate-100 text-slate-700",
    stale: "bg-amber-100 text-amber-900",
  };
  return (
    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
