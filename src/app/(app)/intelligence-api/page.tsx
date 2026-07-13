import { redirect } from "next/navigation";
import {
  Braces,
  Check,
  Clock,
  Database,
  FlaskConical,
  Network,
  Play,
  RefreshCw,
  ScanSearch,
  Send,
  ShieldCheck,
  Store,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  addApiIntelligenceSourceAction,
  configureApiSourceRecheckAction,
  createApiIntelligenceProductAction,
  createApiIntelligenceSoftwareAction,
  decideApiConnectorApprovalAction,
  decideApiChangeRepairAction,
  decideApiIntelligenceClaimAction,
  decideApiIntelligenceDomainAction,
  decideApiIntelligenceMappingAction,
  fetchApiIntelligenceSourceAction,
  generateApiConnectorProposalAction,
  importApiIntelligenceSnapshotAction,
  proposeApiIntelligenceMappingAction,
  runApiCompatibilityCheckAction,
  runApiConnectorContractAction,
  submitApiConnectorApprovalAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import { canonicalEntities } from "@/modules/api-intelligence";

export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950";
const primaryButtonClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800";
const secondaryButtonClass =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50";

export default async function ApiIntelligencePage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  if (!(await services.isPlatformAdmin(user.id))) redirect("/aujourdhui");

  const [workspace, storeEntries] = await Promise.all([
    services.getApiIntelligenceWorkspace(user.id, tenant.id),
    services.getPrivateConnectStore(user.id, tenant.id),
  ]);
  const approvedSoftwareIds = new Set(
    workspace.domains
      .filter((domain) => domain.status === "approved")
      .map((domain) => domain.softwareId),
  );
  const approvedProducts = workspace.products.filter((product) =>
    approvedSoftwareIds.has(product.softwareId),
  );

  return (
    <div className="grid gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Administration plateforme
          </p>
          <h1 className="mt-1 text-4xl font-bold">Intelligence API</h1>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
          <StatusPill label={`${workspace.domains.length} domaines`} />
          <StatusPill label={`${workspace.sources.length} sources`} />
          <StatusPill label={`${workspace.changeEvents.length} changements`} />
          <StatusPill label={`${storeEntries.length} connecteurs sandbox`} />
        </div>
      </header>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <ToolPanel icon={Database} title="Répertoire logiciel">
          <form action={createApiIntelligenceSoftwareAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom canonique">
              <input className={inputClass} name="canonicalName" required />
            </Field>
            <Field label="Éditeur">
              <input className={inputClass} name="vendor" required />
            </Field>
            <Field label="Domaine officiel">
              <input className={inputClass} name="officialDomain" placeholder="docs.editeur.com" required />
            </Field>
            <Field label="Site officiel">
              <input className={inputClass} name="officialWebsite" type="url" placeholder="https://docs.editeur.com" required />
            </Field>
            <Field label="Portail développeur">
              <input className={inputClass} name="developerPortal" type="url" />
            </Field>
            <Field label="Pays">
              <input className={inputClass} name="country" />
            </Field>
            <Field label="Alias">
              <input className={inputClass} name="aliases" placeholder="Produit, ancien nom" />
            </Field>
            <Field label="Régions">
              <input className={inputClass} name="supportedRegions" placeholder="Europe, Antilles" />
            </Field>
            <Field label="Langues">
              <input className={inputClass} name="languages" defaultValue="fr" />
            </Field>
            <Field label="Secteurs">
              <input className={inputClass} name="industries" />
            </Field>
            <Field label="Catégories">
              <input className={inputClass} name="categories" />
            </Field>
            <div className="flex items-end">
              <button className={primaryButtonClass}>
                <Database size={16} aria-hidden />
                Ajouter
              </button>
            </div>
          </form>
        </ToolPanel>

        <ToolPanel icon={ShieldCheck} title="Domaines officiels">
          <div className="divide-y divide-slate-100">
            {workspace.domains.length === 0 ? (
              <EmptyState label="Aucun domaine enregistré" />
            ) : (
              workspace.domains.map((domain) => (
                <div key={domain.id} className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{domain.softwareName}</p>
                      <StatusPill label={statusLabel(domain.status)} tone={statusTone(domain.status)} />
                    </div>
                    <p className="mt-1 break-all text-sm text-slate-600">{domain.domain}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {domain.status !== "approved" ? (
                      <DecisionForm
                        action={decideApiIntelligenceDomainAction}
                        idName="domainId"
                        id={domain.id}
                        decisionName="status"
                        decision="approved"
                        reason="Domaine officiel vérifié."
                        label="Approuver"
                        icon="check"
                      />
                    ) : null}
                    {domain.status !== "paused" ? (
                      <DecisionForm
                        action={decideApiIntelligenceDomainAction}
                        idName="domainId"
                        id={domain.id}
                        decisionName="status"
                        decision="paused"
                        reason="Analyse suspendue par un administrateur."
                        label="Suspendre"
                        icon="x"
                      />
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </ToolPanel>
      </section>

      <section>
        <ToolPanel icon={ShieldCheck} title="Claims et preuves techniques">
          <div className="divide-y divide-slate-100">
            {workspace.claims.length === 0 ? (
              <EmptyState label="Aucun claim importé" />
            ) : (
              workspace.claims.map((claim) => (
                <div key={claim.id} className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{claim.productName} · {claimLabel(claim.claimType)}</p>
                      <StatusPill label={statusLabel(claim.status)} tone={statusTone(claim.status)} />
                    </div>
                    <p className="mt-1 break-all text-xs text-slate-500">{claim.locator} · {claim.sourceUrl}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {claim.status !== "approved" ? (
                      <DecisionForm
                        action={decideApiIntelligenceClaimAction}
                        idName="claimId"
                        id={claim.id}
                        decisionName="status"
                        decision="approved"
                        reason="Preuve technique officielle vérifiée."
                        label="Approuver"
                        icon="check"
                      />
                    ) : null}
                    {claim.status !== "rejected" ? (
                      <DecisionForm
                        action={decideApiIntelligenceClaimAction}
                        idName="claimId"
                        id={claim.id}
                        decisionName="status"
                        decision="rejected"
                        reason="Preuve technique insuffisante ou contradictoire."
                        label="Rejeter"
                        icon="x"
                      />
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </ToolPanel>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <ToolPanel icon={Network} title="Produits API">
          <form action={createApiIntelligenceProductAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Logiciel">
              <select className={inputClass} name="softwareId" required>
                <option value="">Sélectionner</option>
                {workspace.domains
                  .filter((domain) => domain.status === "approved")
                  .map((domain) => (
                    <option key={domain.softwareId} value={domain.softwareId}>
                      {domain.softwareName}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Nom de l’API">
              <input className={inputClass} name="name" required />
            </Field>
            <Field label="Style">
              <select className={inputClass} name="apiStyle" defaultValue="rest">
                <option value="rest">REST</option>
                <option value="graphql">GraphQL</option>
                <option value="webhook">Webhook</option>
                <option value="other">Autre</option>
              </select>
            </Field>
            <Field label="Version">
              <input className={inputClass} name="version" required />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Documentation officielle">
                <input className={inputClass} name="documentationUrl" type="url" required />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <button className={primaryButtonClass}>
                <Network size={16} aria-hidden />
                Créer le produit API
              </button>
            </div>
          </form>
        </ToolPanel>

        <ToolPanel icon={ScanSearch} title="Sources approuvées">
          <form action={addApiIntelligenceSourceAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Produit API">
              <select className={inputClass} name="apiProductId" required>
                <option value="">Sélectionner</option>
                {approvedProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.softwareName} · {product.name} {product.version}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Logiciel">
              <select className={inputClass} name="softwareId" required>
                <option value="">Sélectionner</option>
                {workspace.domains
                  .filter((domain) => domain.status === "approved")
                  .map((domain) => (
                    <option key={domain.softwareId} value={domain.softwareId}>
                      {domain.softwareName}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Format de la source">
              <select className={inputClass} name="sourceType" required>
                <option value="official_openapi_specification">OpenAPI 3</option>
                <option value="official_postman_collection">Collection Postman v2.1</option>
                <option value="official_graphql_schema">Schema GraphQL fourni</option>
                <option value="official_oauth_metadata">Métadonnées OAuth</option>
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="URL officielle de la source">
                <input className={inputClass} name="url" type="url" required />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <button className={primaryButtonClass}>
                <ScanSearch size={16} aria-hidden />
                Enregistrer la source
              </button>
            </div>
          </form>

          <div className="mt-5 divide-y divide-slate-100 border-t border-slate-200">
            {workspace.sources.map((source) => (
              <div key={source.id} className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <p className="font-semibold">{source.softwareName}</p>
                  <p className="mt-1 break-all text-xs text-slate-500">{source.url}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {sourceTypeLabel(source.sourceType)} · {source.latestSnapshotId ? `Snapshot ${shortId(source.latestSnapshotId)}` : "Jamais analysée"}
                  </p>
                  {source.recheck ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusPill
                        label={statusLabel(source.recheck.status)}
                        tone={source.recheck.enabled ? "positive" : source.recheck.status === "blocked" ? "warning" : "neutral"}
                      />
                      <span className="text-xs text-slate-500">
                        {formatRecheckInterval(source.recheck.intervalSeconds)}
                        {source.recheck.nextRunAt && source.recheck.enabled
                          ? ` · prochaine ${formatDateTime(source.recheck.nextRunAt)}`
                          : ""}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="flex max-w-full flex-wrap gap-2">
                  <form action={fetchApiIntelligenceSourceAction}>
                    <input name="sourceId" type="hidden" value={source.id} />
                    <button className={secondaryButtonClass}>
                      <RefreshCw size={15} aria-hidden />
                      Analyser
                    </button>
                  </form>
                  {source.latestSnapshotId && source.apiProductId ? (
                    <form action={importApiIntelligenceSnapshotAction}>
                      <input name="snapshotId" type="hidden" value={source.latestSnapshotId} />
                      <input name="apiProductId" type="hidden" value={source.apiProductId} />
                      <button className={secondaryButtonClass}>
                        <Braces size={15} aria-hidden />
                        Importer
                      </button>
                    </form>
                  ) : null}
                  <form action={configureApiSourceRecheckAction} className="flex max-w-full flex-wrap gap-2">
                    <input name="sourceId" type="hidden" value={source.id} />
                    <input name="enabled" type="hidden" value="true" />
                    <select
                      aria-label="Fréquence de vérification"
                      className={`${inputClass} min-w-44 sm:w-auto`}
                      defaultValue={String(source.recheck?.intervalSeconds ?? 86_400)}
                      name="intervalSeconds"
                    >
                      <option value="3600">Chaque heure</option>
                      <option value="21600">Toutes les 6 heures</option>
                      <option value="86400">Chaque jour</option>
                      <option value="604800">Chaque semaine</option>
                    </select>
                    <button className={secondaryButtonClass} title="Planifier les vérifications">
                      <Clock size={15} aria-hidden />
                      {source.recheck?.enabled ? "Modifier" : "Planifier"}
                    </button>
                  </form>
                  {source.recheck?.enabled ? (
                    <form action={configureApiSourceRecheckAction}>
                      <input name="sourceId" type="hidden" value={source.id} />
                      <input name="enabled" type="hidden" value="false" />
                      <input name="intervalSeconds" type="hidden" value={source.recheck.intervalSeconds} />
                      <button className={secondaryButtonClass}>
                        <X size={15} aria-hidden />
                        Suspendre
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </ToolPanel>
      </section>

      <section id="changements-api">
        <ToolPanel icon={TriangleAlert} title="Suivi des changements API">
          <div className="grid gap-6 xl:grid-cols-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Historique global</h3>
              <div className="mt-2 divide-y divide-slate-100">
                {workspace.changeEvents.length === 0 ? (
                  <EmptyState label="Aucun changement détecté" />
                ) : (
                  workspace.changeEvents.map((event) => (
                    <div key={event.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{event.softwareName} · {event.productName}</p>
                        <StatusPill
                          label={statusLabel(event.primaryClassification)}
                          tone={event.requiresApproval ? "warning" : "neutral"}
                        />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {event.summary?.changes.length ?? 0} changement(s) · {event.affectedConnectorCount} connecteur(s) · {event.affectedTenantCount} tenant(s)
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-900">Réparations de ce tenant</h3>
              <div className="mt-2 divide-y divide-slate-100">
                {workspace.changeImpacts.length === 0 ? (
                  <EmptyState label="Aucun connecteur touché" />
                ) : (
                  workspace.changeImpacts.map((impact) => (
                    <div key={impact.id} className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{impact.connectorName}</p>
                          <StatusPill label="Mise à niveau bloquée" tone="warning" />
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {statusLabel(impact.primaryClassification)} · Test {statusLabel(impact.contractTestStatus)} · {statusLabel(impact.approvalStatus)}
                        </p>
                      </div>
                      {impact.approvalStatus === "pending" ? (
                        <div className="flex flex-wrap gap-2">
                          <DecisionForm
                            action={decideApiChangeRepairAction}
                            idName="impactId"
                            id={impact.id}
                            decisionName="decision"
                            decision="approved"
                            reason="Plan de réparation examiné; régénération et nouveaux tests toujours requis."
                            label="Approuver le plan"
                            icon="check"
                          />
                          <DecisionForm
                            action={decideApiChangeRepairAction}
                            idName="impactId"
                            id={impact.id}
                            decisionName="decision"
                            decision="rejected"
                            reason="Plan de réparation refusé; le connecteur reste bloqué."
                            label="Rejeter"
                            icon="x"
                          />
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </ToolPanel>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <ToolPanel icon={Braces} title="Ontologie">
          <form action={proposeApiIntelligenceMappingAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Objet source et preuve">
              <select className={inputClass} name="evidenceId" required>
                <option value="">Sélectionner</option>
                {workspace.schemas
                  .filter(
                    (schema) =>
                      schema.evidenceId && schema.claimStatus === "approved",
                  )
                  .map((schema) => (
                    <option key={schema.id} value={schema.evidenceId}>
                      {schema.productName} · {schema.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Produit API">
              <select className={inputClass} name="apiProductId" required>
                <option value="">Sélectionner</option>
                {approvedProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} {product.version}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Objet source">
              <input className={inputClass} name="sourceEntity" required />
            </Field>
            <Field label="Entité canonique">
              <select className={inputClass} name="canonicalEntity" required>
                {canonicalEntities.map((entity) => (
                  <option key={entity} value={entity}>{entity}</option>
                ))}
              </select>
            </Field>
            <Field label="Confiance">
              <input className={inputClass} name="confidence" type="number" min="0" max="100" defaultValue="90" required />
            </Field>
            <div className="flex items-end">
              <button className={primaryButtonClass}>
                <Braces size={16} aria-hidden />
                Proposer le mapping
              </button>
            </div>
          </form>
          <div className="mt-5 divide-y divide-slate-100 border-t border-slate-200">
            {workspace.mappings.map((mapping) => (
              <div key={mapping.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold">{mapping.sourceEntity} → {mapping.canonicalEntity}</p>
                  <p className="text-xs text-slate-500">Confiance {mapping.confidence}% · {statusLabel(mapping.status)}</p>
                </div>
                {mapping.status === "pending" ? (
                  <div className="flex gap-2">
                    <DecisionForm action={decideApiIntelligenceMappingAction} idName="mappingId" id={mapping.id} decisionName="status" decision="approved" label="Approuver" icon="check" />
                    <DecisionForm action={decideApiIntelligenceMappingAction} idName="mappingId" id={mapping.id} decisionName="status" decision="rejected" label="Rejeter" icon="x" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </ToolPanel>

        <ToolPanel icon={FlaskConical} title="Compatibilité">
          <form action={runApiCompatibilityCheckAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Produit API">
              <select className={inputClass} name="apiProductId" required>
                <option value="">Sélectionner</option>
                {approvedProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.softwareName} · {product.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Logiciel">
              <select className={inputClass} name="softwareId" required>
                <option value="">Sélectionner</option>
                {workspace.domains
                  .filter((domain) => domain.status === "approved")
                  .map((domain) => (
                    <option key={domain.softwareId} value={domain.softwareId}>
                      {domain.softwareName}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Secteur du tenant">
              <input className={inputClass} name="tenantIndustry" defaultValue={tenant.category} required />
            </Field>
            <Field label="Automatisation souhaitée">
              <input className={inputClass} name="desiredAutomation" required />
            </Field>
            <div className="sm:col-span-2">
              <button className={primaryButtonClass}>
                <FlaskConical size={16} aria-hidden />
                Vérifier la compatibilité
              </button>
            </div>
          </form>
          <div className="mt-5 divide-y divide-slate-100 border-t border-slate-200">
            {workspace.compatibilityChecks.map((check) => (
              <div key={check.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold">{check.softwareName}</p>
                  <p className="mt-1 text-sm text-slate-600">{check.desiredAutomation}</p>
                </div>
                <StatusPill label={statusLabel(check.outcome)} tone={check.outcome === "custom_connector_possible" ? "positive" : "neutral"} />
              </div>
            ))}
          </div>
        </ToolPanel>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <ToolPanel icon={ShieldCheck} title="Connector Copilot">
          <form action={generateApiConnectorProposalAction} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <Field label="Analyse compatible">
              <select className={inputClass} name="compatibilityCheckId" required>
                <option value="">Sélectionner</option>
                {workspace.compatibilityChecks
                  .filter((check) => check.outcome === "custom_connector_possible")
                  .map((check) => (
                    <option key={check.id} value={check.id}>
                      {check.softwareName} · {shortId(check.id)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Nom du connecteur">
              <input className={inputClass} name="name" required />
            </Field>
            <button className={primaryButtonClass}>
              <ShieldCheck size={16} aria-hidden />
              Générer
            </button>
          </form>
          <div className="mt-5 divide-y divide-slate-100 border-t border-slate-200">
            {workspace.proposals.map((proposal) => (
              <div key={proposal.id} className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{proposal.name}</p>
                    <StatusPill label="Désactivé" tone="warning" />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {statusLabel(proposal.status)} · Tests {statusLabel(proposal.contractStatus ?? "not_run")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <form action={runApiConnectorContractAction}>
                    <input name="proposalId" type="hidden" value={proposal.id} />
                    <button className={secondaryButtonClass}>
                      <Play size={15} aria-hidden />
                      Tests mock
                    </button>
                  </form>
                  {proposal.contractStatus === "passed" && proposal.status !== "security_review_required" && proposal.status !== "approved_for_sandbox" ? (
                    <form action={submitApiConnectorApprovalAction}>
                      <input name="proposalId" type="hidden" value={proposal.id} />
                      <button className={secondaryButtonClass}>
                        <Send size={15} aria-hidden />
                        Soumettre
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </ToolPanel>

        <ToolPanel icon={Check} title="Approbations sandbox">
          <div className="divide-y divide-slate-100">
            {workspace.approvals.length === 0 ? (
              <EmptyState label="Aucune demande en attente" />
            ) : (
              workspace.approvals.map((approval) => (
                <div key={approval.id} className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div>
                    <p className="font-semibold">{approval.connectorName}</p>
                    <p className="mt-1 text-xs text-slate-500">Portée {approval.requestedScope} · {statusLabel(approval.status)}</p>
                  </div>
                  {approval.status === "pending" ? (
                    <div className="flex flex-wrap gap-2">
                      <ApprovalDecisionForm approvalId={approval.id} decision="approved" label="Approuver sandbox" icon="check" />
                      <ApprovalDecisionForm approvalId={approval.id} decision="rejected" label="Rejeter" icon="x" />
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </ToolPanel>
      </section>

      <section>
        <div className="mb-4 flex items-center gap-3">
          <Store size={22} aria-hidden />
          <h2 className="text-2xl font-bold">Connect Store privé</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {storeEntries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
              Aucun connecteur approuvé pour le sandbox
            </div>
          ) : (
            storeEntries.map((entry) => (
              <article key={entry.id} className="rounded-lg border border-emerald-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Sandbox uniquement</p>
                    <h3 className="mt-1 text-lg font-bold">{entry.connectorName}</h3>
                  </div>
                  <ShieldCheck className="text-emerald-700" size={20} aria-hidden />
                </div>
                <p className="mt-3 text-sm text-slate-600">{entry.softwareName} · API {entry.apiVersion}</p>
                <dl className="mt-4 grid gap-2 text-sm">
                  <StoreFact label="Version" value={entry.connectorVersion} />
                  <StoreFact label="Installation" value={statusLabel(entry.installationStatus)} />
                  <StoreFact label="Activation" value="Désactivée" />
                </dl>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ToolPanel({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Database;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-700">
          <Icon size={18} aria-hidden />
        </span>
        <h2 className="text-xl font-bold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
      {label}
      {children}
    </label>
  );
}

function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "positive" | "warning";
}) {
  const colors = {
    neutral: "bg-slate-100 text-slate-700",
    positive: "bg-emerald-100 text-emerald-800",
    warning: "bg-amber-100 text-amber-900",
  };
  return <span className={`rounded-md px-2 py-1 text-xs font-semibold ${colors[tone]}`}>{label}</span>;
}

function DecisionForm({
  action,
  idName,
  id,
  decisionName,
  decision,
  reason,
  label,
  icon,
}: {
  action: (formData: FormData) => Promise<void>;
  idName: string;
  id: string;
  decisionName: string;
  decision: string;
  reason?: string;
  label: string;
  icon: "check" | "x";
}) {
  const Icon = icon === "check" ? Check : X;
  return (
    <form action={action}>
      <input name={idName} type="hidden" value={id} />
      <input name={decisionName} type="hidden" value={decision} />
      {reason ? <input name="reason" type="hidden" value={reason} /> : null}
      <button className={secondaryButtonClass}>
        <Icon size={15} aria-hidden />
        {label}
      </button>
    </form>
  );
}

function ApprovalDecisionForm({
  approvalId,
  decision,
  label,
  icon,
}: {
  approvalId: string;
  decision: "approved" | "rejected";
  label: string;
  icon: "check" | "x";
}) {
  const Icon = icon === "check" ? Check : X;
  return (
    <form action={decideApiConnectorApprovalAction}>
      <input name="approvalId" type="hidden" value={approvalId} />
      <input name="decision" type="hidden" value={decision} />
      <input
        name="reason"
        type="hidden"
        value={decision === "approved" ? "Tests mock et preuves approuvées." : "Approbation sandbox refusée."}
      />
      <button className={secondaryButtonClass}>
        <Icon size={15} aria-hidden />
        {label}
      </button>
    </form>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className="py-5 text-sm text-slate-500">{label}</p>;
}

function StoreFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 15)}…` : value;
}

function statusTone(status: string): "neutral" | "positive" | "warning" {
  if (["approved", "passed", "approved_for_sandbox"].includes(status)) return "positive";
  if (["pending", "paused", "under_review"].includes(status)) return "warning";
  return "neutral";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    approved: "Approuvé",
    approved_for_sandbox: "Approuvé sandbox",
    additive: "Additif",
    blocked: "Bloqué",
    breaking: "Rupture",
    access_policy_change: "Politique d’accès modifiée",
    change_review_required: "Revue de changement requise",
    contract_tests_passed: "Tests réussis",
    custom_connector_possible: "Connecteur possible",
    denied: "Refusé",
    failed: "Échec",
    not_installed: "Non installé",
    not_run: "non exécutés",
    informational: "Informationnel",
    passed: "réussis",
    paused: "Suspendu",
    pending: "En attente",
    rejected: "Rejeté",
    repair_approved: "Plan approuvé",
    repair_rejected: "Plan rejeté",
    retrying: "Nouvelle tentative planifiée",
    scheduled: "Planifiée",
    processing: "Analyse en cours",
    succeeded: "À jour",
    disabled: "Suspendue",
    potentially_breaking: "Risque de rupture",
    security_relevant: "Sécurité",
    security_review_required: "Revue requise",
    static_checks_passed: "Contrôles statiques réussis",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

function formatRecheckInterval(seconds: number) {
  if (seconds === 3_600) return "Vérification horaire";
  if (seconds === 21_600) return "Vérification toutes les 6 heures";
  if (seconds === 604_800) return "Vérification hebdomadaire";
  return "Vérification quotidienne";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Martinique",
  }).format(new Date(value));
}

function sourceTypeLabel(sourceType: string) {
  if (sourceType === "official_openapi_specification") return "OpenAPI 3";
  if (sourceType === "official_postman_collection") return "Postman v2.1";
  if (sourceType === "official_graphql_schema") return "GraphQL fourni";
  if (sourceType === "official_oauth_metadata") return "Métadonnées OAuth";
  return "Source officielle";
}

function claimLabel(claimType: string) {
  const labels: Record<string, string> = {
    api_metadata: "Métadonnées API",
    operation_exists: "Opération",
    schema_exists: "Schéma",
  };
  return labels[claimType] ?? claimType;
}
