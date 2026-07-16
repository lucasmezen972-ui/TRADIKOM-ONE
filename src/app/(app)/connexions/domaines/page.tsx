import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Globe2,
  Link2,
  Play,
  Search,
  Server,
  ShieldCheck,
  TriangleAlert,
  Unlink,
} from "lucide-react";
import {
  analyzeDomainConnectionAction,
  approveDnsChangePlanAction,
  confirmDnsChangePlanAction,
  disconnectWebsiteDomainBindingAction,
  prepareDnsChangePlanAction,
  requestWebsiteDomainBindingAction,
  simulateDnsChangePlanAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

const stateLabels: Record<string, string> = {
  discovered: "Découvert",
  analysis_pending: "Analyse en attente",
  analyzed: "Analysé",
  manual_setup_required: "Configuration manuelle",
  provider_connection_available: "Connexion fournisseur disponible",
  awaiting_approval: "Approbation requise",
  change_plan_ready: "Plan simulé",
  applying: "Application en cours",
  propagation_pending: "Propagation en attente",
  verified: "Vérifié",
  failed: "Échec",
  rollback_required: "Retour arrière requis",
  disconnected: "Déconnecté",
};

const planLabels: Record<string, string> = {
  awaiting_approval: "Première approbation requise",
  awaiting_second_confirmation: "Deuxième confirmation requise",
  approved_for_simulation: "Prêt à simuler",
  simulated: "Simulation réussie",
  expired: "Plan expiré",
  rejected: "Plan rejeté",
};

export default async function DomainConnectionsPage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const workspace = await services
    .getDomainConnectionWorkspace(user.id, tenant.id)
    .catch(() => null);

  return (
    <div className="grid gap-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/connexions"
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"
          >
            <ArrowLeft size={16} aria-hidden />
            Connexions
          </Link>
          <p className="mt-4 text-sm uppercase tracking-[0.16em] text-slate-500">
            Centre de connexion
          </p>
          <h1 className="mt-1 text-3xl font-bold">Domaines</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Analysez les enregistrements, contrôlez les risques puis simulez un
            plan. Aucun changement DNS réel n’est appliqué dans cet environnement.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-md bg-[#e6fffb] px-3 py-2 text-xs font-semibold text-[#075e57]">
          <ShieldCheck size={16} aria-hidden />
          Simulation contrôlée
        </span>
      </header>

      {workspace === null ? (
        <section className="border-y border-red-200 bg-red-50 px-4 py-5 text-sm text-red-800">
          L’espace domaines est temporairement indisponible. Aucun changement
          externe n’a été effectué.
        </section>
      ) : (
        <>
          <section className="grid gap-4 border-y border-slate-200 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]">
            <div>
              <h2 className="text-xl font-bold">Analyser un domaine</h2>
              <p className="mt-2 text-sm text-slate-600">
                Le fournisseur mock utilise uniquement des fixtures locales. Le
                mode manuel ne présente aucune hypothèse comme un fait.
              </p>
            </div>
            {workspace.canManage ? (
              <form action={analyzeDomainConnectionAction} className="grid gap-3">
                <label className="grid gap-1 text-sm font-semibold" htmlFor="domain">
                  Nom de domaine
                  <input
                    id="domain"
                    name="domain"
                    required
                    placeholder="entreprise.example.test"
                    className="min-h-11 rounded-md border border-slate-300 bg-white px-3 font-normal"
                  />
                </label>
                <label className="grid gap-1 text-sm font-semibold" htmlFor="providerKey">
                  Méthode
                  <select
                    id="providerKey"
                    name="providerKey"
                    className="min-h-11 rounded-md border border-slate-300 bg-white px-3 font-normal"
                    defaultValue="mock_dns"
                  >
                    <option value="mock_dns">Fournisseur DNS de test</option>
                    <option value="manual">Configuration manuelle</option>
                  </select>
                </label>
                <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                  <Search size={17} aria-hidden />
                  Analyser le domaine
                </button>
              </form>
            ) : (
              <p className="text-sm text-slate-600">
                Seuls le propriétaire et les administrateurs peuvent préparer un
                domaine.
              </p>
            )}
          </section>

          <section className="grid gap-4">
            <div className="flex items-center gap-3">
              <Globe2 size={21} aria-hidden />
              <h2 className="text-xl font-bold">Domaines analysés</h2>
            </div>
            {workspace.connections.length === 0 ? (
              <div className="border-y border-slate-200 py-8 text-sm text-slate-600">
                Aucun domaine analysé pour cette organisation.
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {workspace.connections.map((connection) => {
                  const plan = workspace.plans.find(
                    (item) => item.connectionId === connection.id,
                  );
                  return (
                    <article
                      key={connection.id}
                      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-bold">{connection.domain}</h3>
                          <p className="mt-1 text-sm text-slate-600">
                            {connection.providerLabel}
                          </p>
                        </div>
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                          {stateLabels[connection.state] ?? connection.state}
                        </span>
                      </div>

                      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="font-semibold">Registraire probable</dt>
                          <dd className="mt-1 text-slate-600">
                            {connection.likelyRegistrar ?? "Non vérifié"}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold">Hébergement probable</dt>
                          <dd className="mt-1 text-slate-600">
                            {connection.likelyHosting ?? "Non vérifié"}
                          </dd>
                        </div>
                      </dl>

                      <div className="mt-5">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <Server size={16} aria-hidden />
                          Enregistrements actuels
                        </div>
                        {connection.records.length === 0 ? (
                          <p className="mt-2 text-sm text-slate-500">
                            Aucun enregistrement vérifié. Utilisez le guide manuel.
                          </p>
                        ) : (
                          <div className="mt-2 max-h-48 overflow-auto rounded-md border border-slate-200">
                            {connection.records.map((record, index) => (
                              <div
                                key={`${record.type}-${record.name}-${index}`}
                                className="grid grid-cols-[64px_minmax(0,1fr)] gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-0"
                              >
                                <span className="font-bold text-[#075e57]">
                                  {record.type}
                                </span>
                                <span className="min-w-0 break-all text-slate-600">
                                  {record.name} → {record.value}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="mt-5 border-t border-slate-100 pt-4">
                        <p className="text-sm font-semibold">Preuves</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {connection.evidence.length} éléments · {connection.evidence.filter((item) => item.status === "verified").length} vérifiés
                        </p>
                        {!plan && workspace.canManage ? (
                          <form action={prepareDnsChangePlanAction} className="mt-3">
                            <input type="hidden" name="connectionId" value={connection.id} />
                            <button className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50">
                              <ClipboardCheck size={16} aria-hidden />
                              Préparer le plan DNS
                            </button>
                          </form>
                        ) : plan ? (
                          <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#075e57]">
                            <CheckCircle2 size={16} aria-hidden />
                            Plan associé : {planLabels[plan.status] ?? plan.status}
                          </p>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="grid gap-4">
            <div className="flex items-center gap-3">
              <ClipboardCheck size={21} aria-hidden />
              <h2 className="text-xl font-bold">Plans DNS</h2>
            </div>
            {workspace.plans.length === 0 ? (
              <div className="border-y border-slate-200 py-8 text-sm text-slate-600">
                Aucun plan DNS en attente.
              </div>
            ) : (
              <div className="grid gap-4">
                {workspace.plans.map((plan) => {
                  const connection = workspace.connections.find(
                    (item) => item.id === plan.connectionId,
                  );
                  const binding = workspace.bindings.find(
                    (item) => item.connectionId === plan.connectionId,
                  );
                  return (
                    <article
                      key={plan.id}
                      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-bold">
                            {connection?.domain ?? "Domaine"}
                          </h3>
                          <p className="mt-1 text-sm text-slate-600">
                            {planLabels[plan.status] ?? plan.status}
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-2 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
                          <TriangleAlert size={14} aria-hidden />
                          Aucun effet externe
                        </span>
                      </div>

                      <div className="mt-4 grid gap-4 lg:grid-cols-2">
                        <div>
                          <p className="text-sm font-semibold">Changements proposés</p>
                          <ul className="mt-2 grid gap-2 text-sm text-slate-600">
                            {plan.changes.map((change, index) => (
                              <li key={`${change.record.type}-${index}`}>
                                {change.action === "create" ? "Ajouter" : "Modifier"} {change.record.type} {change.record.name} → {change.record.value}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="text-sm font-semibold">Guide manuel</p>
                          <ol className="mt-2 grid gap-2 text-sm text-slate-600">
                            {plan.manualGuide.map((step) => (
                              <li key={step.step}>
                                {step.step}. {step.menuLabel} · {step.name} · TTL {step.ttl}
                              </li>
                            ))}
                          </ol>
                        </div>
                      </div>
                      <p className="mt-4 border-y border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                        Le site public actuel reste actif pendant la vérification. Un brouillon en cours ne remplace jamais la version publiée.
                      </p>

                      {workspace.canManage ? (
                        <div className="mt-5 flex flex-wrap gap-3 border-t border-slate-100 pt-4">
                          {plan.status === "awaiting_approval" ? (
                            <PlanAction
                              action={approveDnsChangePlanAction}
                              planId={plan.id}
                              label="Approuver le plan"
                            />
                          ) : null}
                          {plan.status === "awaiting_second_confirmation" ? (
                            <PlanAction
                              action={confirmDnsChangePlanAction}
                              planId={plan.id}
                              label="Confirmer une seconde fois"
                            />
                          ) : null}
                          {plan.status === "approved_for_simulation" ? (
                            <PlanAction
                              action={simulateDnsChangePlanAction}
                              planId={plan.id}
                              label="Simuler le changement"
                              icon="play"
                            />
                          ) : null}
                          {plan.status === "simulated" ? (
                            <div className="grid w-full gap-3">
                              <p className="inline-flex items-center gap-2 text-sm font-semibold text-[#075e57]">
                                <CheckCircle2 size={17} aria-hidden />
                                Simulation terminée, aucune modification appliquée
                              </p>
                              {!binding || ["failed", "disconnected"].includes(binding.status) ? (
                                <form action={requestWebsiteDomainBindingAction}>
                                  <input
                                    type="hidden"
                                    name="connectionId"
                                    value={plan.connectionId}
                                  />
                                  <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                                    <Link2 size={16} aria-hidden />
                                    Vérifier et lier au site publié
                                  </button>
                                </form>
                              ) : null}
                              {binding?.status === "pending_verification" ? (
                                <p className="text-sm font-semibold text-amber-800">
                                  Vérification de propagation en attente. Le brouillon reste hors ligne.
                                </p>
                              ) : null}
                              {binding?.status === "bound" ? (
                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-teal-200 bg-teal-50 px-3 py-3">
                                  <div>
                                    <p className="text-sm font-bold text-[#075e57]">
                                      Domaine lié au site publié
                                    </p>
                                    <p className="mt-1 text-xs text-slate-600">
                                      Certificat de test vérifié. Les brouillons ne sont jamais publiés automatiquement.
                                    </p>
                                  </div>
                                  <form action={disconnectWebsiteDomainBindingAction}>
                                    <input type="hidden" name="bindingId" value={binding.id} />
                                    <button className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-50">
                                      <Unlink size={16} aria-hidden />
                                      Déconnecter le domaine
                                    </button>
                                  </form>
                                </div>
                              ) : null}
                              {binding?.status === "failed" ? (
                                <p className="text-sm text-red-800">
                                  La propagation n’a pas été vérifiée. Aucun site ni enregistrement DNS n’a été modifié.
                                </p>
                              ) : null}
                              {binding?.status === "disconnected" ? (
                                <p className="text-sm text-slate-600">
                                  Liaison déconnectée. Retirez manuellement uniquement l’enregistrement ajouté pour revenir à l’état précédent.
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function PlanAction({
  action,
  planId,
  label,
  icon,
}: {
  action: (formData: FormData) => Promise<void>;
  planId: string;
  label: string;
  icon?: "play";
}) {
  return (
    <form action={action}>
      <input type="hidden" name="planId" value={planId} />
      <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
        {icon === "play" ? <Play size={16} aria-hidden /> : <ShieldCheck size={16} aria-hidden />}
        {label}
      </button>
    </form>
  );
}
