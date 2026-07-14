import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  decideSelfImprovementProposalAction,
  generateSelfImprovementProposalsAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

const severityStyles = {
  critical: "border-red-200 bg-red-50 text-red-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
} as const;

const decisionLabels = {
  pending: "À décider",
  accepted: "Retenue pour planification",
  dismissed: "Écartée",
} as const;

export default async function SelfImprovementPage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const workspace = await services.getSelfImprovementWorkspace(user.id, tenant.id);
  const measured = workspace.coverage.filter((item) => item.status === "measured");
  const unavailable = workspace.coverage.filter((item) => item.status === "unavailable");

  return (
    <div className="grid gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Self Improvement
          </p>
          <h1 className="mt-1 text-4xl font-bold">Amélioration continue</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Des propositions internes fondées sur des mesures existantes, sans
            modification automatique de votre activité.
          </p>
        </div>
        {workspace.canManage ? (
          <form action={generateSelfImprovementProposalsAction}>
            <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white">
              <RefreshCw size={16} aria-hidden />
              Analyser les signaux mesurés
            </button>
          </form>
        ) : null}
      </header>

      <div className="flex items-start gap-3 rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
        <ShieldCheck className="mt-0.5 shrink-0" size={19} aria-hidden />
        <p>
          Accepter une proposition l&apos;ajoute uniquement à la planification. Aucun
          workflow, contact, connecteur, message, paiement ou site n&apos;est modifié.
        </p>
      </div>

      <section className="grid gap-4 lg:grid-cols-[1fr_0.7fr]">
        <div className="border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <Gauge size={19} className="text-teal-700" aria-hidden />
            <h2 className="text-lg font-bold">Signaux mesurés</h2>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {measured.map((item) => (
              <p key={item.key} className="flex items-center gap-2 text-sm text-slate-700">
                <CheckCircle2 size={15} className="text-teal-700" aria-hidden />
                {item.label}
              </p>
            ))}
          </div>
        </div>
        <div className="border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <Eye size={19} className="text-slate-500" aria-hidden />
            <h2 className="text-lg font-bold">Mesure indisponible</h2>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Aucune conclusion n&apos;est inventée sans télémétrie fiable.
          </p>
          <p className="mt-3 text-sm text-slate-700">
            {unavailable.map((item) => item.label).join(" · ")}
          </p>
        </div>
      </section>

      <section>
        <div className="flex items-center gap-2">
          <Sparkles size={20} className="text-teal-700" aria-hidden />
          <h2 className="text-xl font-bold">Propositions explicables</h2>
        </div>
        {workspace.proposals.length === 0 ? (
          <div className="mt-3 border border-dashed border-slate-300 bg-white px-5 py-9 text-center text-sm text-slate-600">
            Aucun signal mesuré ne nécessite actuellement de proposition.
          </div>
        ) : (
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {workspace.proposals.map((proposal) => (
              <article key={proposal.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold">{proposal.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">{proposal.explanation}</p>
                  </div>
                  <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${severityStyles[proposal.severity]}`}>
                    Confiance {proposal.confidence} %
                  </span>
                </div>

                <div className="mt-4 border-l-2 border-teal-600 pl-3">
                  <p className="text-sm font-semibold">Amélioration proposée</p>
                  <p className="mt-1 text-sm text-slate-700">{proposal.recommendation}</p>
                </div>

                <div className="mt-4">
                  <p className="text-sm font-semibold">Preuves mesurées</p>
                  <div className="mt-2 grid gap-2">
                    {proposal.evidence.map((evidence) => (
                      <p key={evidence.key} className="text-sm text-slate-600">
                        {evidence.summary}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <Link
                    href={proposal.actionHref}
                    className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold"
                  >
                    <Eye size={16} aria-hidden />
                    {proposal.actionLabel}
                  </Link>
                  <span className="text-xs font-semibold text-slate-600">
                    {decisionLabels[proposal.decisionStatus]} · v{proposal.version}
                  </span>
                </div>

                {workspace.canManage && proposal.decisionStatus === "pending" ? (
                  <form action={decideSelfImprovementProposalAction} className="mt-4 grid gap-3">
                    <input type="hidden" name="proposalId" value={proposal.id} />
                    <label className="grid gap-1 text-sm font-semibold">
                      Motif de décision
                      <textarea
                        name="reason"
                        required
                        minLength={10}
                        maxLength={800}
                        className="min-h-20 rounded-md border border-slate-300 px-3 py-2 font-normal"
                        placeholder="Décision interne documentée"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        name="decision"
                        value="accepted"
                        className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white"
                      >
                        <CheckCircle2 size={16} aria-hidden />
                        Retenir pour planification
                      </button>
                      <button
                        name="decision"
                        value="dismissed"
                        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold"
                      >
                        <AlertTriangle size={16} aria-hidden />
                        Écarter
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
