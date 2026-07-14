import { Archive, CheckCircle2, Plus, Save, TriangleAlert } from "lucide-react";
import {
  archiveBusinessBrainEntryAction,
  createBusinessBrainEntryAction,
  reviseBusinessBrainEntryAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import type {
  BusinessBrainDomain,
  BusinessBrainEvidenceType,
} from "@/modules/business-brain";

export const dynamic = "force-dynamic";

const domains: Array<{ value: BusinessBrainDomain; label: string }> = [
  { value: "company", label: "Entreprise" },
  { value: "customers", label: "Clients" },
  { value: "suppliers", label: "Fournisseurs" },
  { value: "catalog", label: "Produits et services" },
  { value: "pricing", label: "Prix" },
  { value: "margins", label: "Marges" },
  { value: "objectives", label: "Objectifs" },
  { value: "kpis", label: "Indicateurs" },
  { value: "team", label: "Équipe" },
  { value: "locations", label: "Implantations" },
  { value: "automations", label: "Automatisations" },
  { value: "websites", label: "Sites web" },
  { value: "api", label: "API" },
  { value: "connectors", label: "Connecteurs" },
];

const evidenceTypes: Array<{
  value: BusinessBrainEvidenceType;
  label: string;
}> = [
  { value: "observation", label: "Observation vérifiée" },
  { value: "document", label: "Document" },
  { value: "system_record", label: "Donnée du système" },
  { value: "import", label: "Import" },
];

type BusinessBrainPageProps = {
  searchParams: Promise<{
    ajout?: string;
    revision?: string;
    archive?: string;
  }>;
};

export default async function BusinessBrainPage({
  searchParams,
}: BusinessBrainPageProps) {
  const params = await searchParams;
  const { user, tenant, membership } = await requireTenantContext();
  const services = await getServices();
  const workspace = await services.getBusinessBrain(user.id, tenant.id);
  const canWrite = membership.role !== "read-only";
  const completedDomains = workspace.coverage.filter(
    (item) => item.status !== "missing",
  ).length;

  return (
    <div className="grid gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Mémoire opérationnelle
          </p>
          <h1 className="mt-1 text-4xl font-bold">Cerveau d&apos;entreprise</h1>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-right shadow-sm">
          <p className="text-sm text-slate-500">Couverture</p>
          <p className="text-2xl font-bold">
            {completedDomains}/{workspace.coverage.length}
          </p>
        </div>
      </header>

      {params.ajout || params.revision || params.archive ? (
        <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">
          <CheckCircle2 size={18} aria-hidden />
          {params.ajout
            ? "Information ajoutée à la mémoire."
            : params.revision
              ? "Nouvelle version enregistrée."
              : "Information archivée."}
        </div>
      ) : null}

      <section aria-labelledby="signals-title">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 id="signals-title" className="text-xl font-bold">
            Signaux actuels
          </h2>
          <span className="text-sm text-slate-500">
            Données tenant synchronisées
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Signal label="Contacts" value={workspace.signals.contacts} />
          <Signal label="Opportunités" value={workspace.signals.opportunities} />
          <Signal
            label="Valeur du pipeline"
            value={formatCurrency(workspace.signals.pipelineValueCents)}
          />
          <Signal
            label="Automatisations actives"
            value={workspace.signals.activeWorkflows}
          />
          <Signal label="Membres" value={workspace.signals.members} />
          <Signal label="Sites publiés" value={workspace.signals.publishedWebsites} />
          <Signal label="Connecteurs" value={workspace.signals.connectors} />
          <Signal label="Actifs API" value={workspace.signals.apiAssets} />
        </div>
      </section>

      <section className="rounded-lg bg-white p-5 shadow-sm" aria-labelledby="coverage-title">
        <h2 id="coverage-title" className="text-xl font-bold">
          Couverture métier
        </h2>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {workspace.coverage.map((item) => (
            <div
              key={item.domain}
              className="flex min-h-20 items-center justify-between gap-4 rounded-md border border-slate-200 px-4 py-3"
            >
              <div>
                <p className="font-semibold">{domainLabel(item.domain)}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {item.connectedRecords} source{item.connectedRecords > 1 ? "s" : ""}
                  {" · "}
                  {item.managedEntries} mémoire{item.managedEntries > 1 ? "s" : ""}
                </p>
              </div>
              <CoverageStatus status={item.status} />
            </div>
          ))}
        </div>
      </section>

      {canWrite ? <CreateEntryForm /> : null}

      <section aria-labelledby="memory-title">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 id="memory-title" className="text-xl font-bold">
            Informations vérifiées
          </h2>
          <span className="text-sm text-slate-500">
            {workspace.entries.length} active{workspace.entries.length > 1 ? "s" : ""}
          </span>
        </div>
        {workspace.entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
            <p className="font-semibold">Aucune information manuelle active</p>
            <p className="mt-1 text-sm text-slate-500">
              Les signaux connectés restent disponibles dans la couverture métier.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {workspace.entries.map((entry) => (
              <article key={entry.id} className="rounded-lg bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-700">
                      {domainLabel(entry.domain)}
                    </p>
                    <h3 className="mt-1 text-lg font-bold">{entry.title}</h3>
                  </div>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                    v{entry.version} · {entry.confidence}%
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-700">{entry.summary}</p>
                {entry.details ? (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                    {entry.details}
                  </p>
                ) : null}
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Preuve
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {entry.evidence[0]?.summary ?? "Preuve non disponible"}
                  </p>
                </div>
                {canWrite ? (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <details className="min-w-0 flex-1">
                      <summary className="cursor-pointer text-sm font-semibold text-teal-800">
                        Créer une nouvelle version
                      </summary>
                      <RevisionForm entry={entry} />
                    </details>
                    <form action={archiveBusinessBrainEntryAction}>
                      <input type="hidden" name="entryId" value={entry.id} />
                      <button className="inline-flex min-h-10 items-center gap-2 rounded-md border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-50">
                        <Archive size={16} aria-hidden />
                        Archiver
                      </button>
                    </form>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CreateEntryForm() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="add-memory-title">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-md bg-teal-100 text-teal-800">
          <Plus size={18} aria-hidden />
        </span>
        <h2 id="add-memory-title" className="text-xl font-bold">
          Ajouter une information
        </h2>
      </div>
      <form action={createBusinessBrainEntryAction} className="mt-5 grid gap-4">
        <EntryFields />
        <button className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
          <Save size={18} aria-hidden />
          Enregistrer
        </button>
      </form>
    </section>
  );
}

function RevisionForm({
  entry,
}: {
  entry: {
    id: string;
    domain: BusinessBrainDomain;
    title: string;
    summary: string;
    details: string;
    confidence: number;
    sourceRef?: string;
  };
}) {
  return (
    <form action={reviseBusinessBrainEntryAction} className="mt-4 grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4">
      <input type="hidden" name="entryId" value={entry.id} />
      <EntryFields defaults={entry} compact />
      <button className="inline-flex min-h-10 w-fit items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
        <Save size={16} aria-hidden />
        Enregistrer la version
      </button>
    </form>
  );
}

function EntryFields({
  defaults,
  compact = false,
}: {
  defaults?: {
    domain: BusinessBrainDomain;
    title: string;
    summary: string;
    details: string;
    confidence: number;
    sourceRef?: string;
  };
  compact?: boolean;
}) {
  return (
    <div className={compact ? "grid gap-3" : "grid gap-4 md:grid-cols-2"}>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        Domaine
        <select
          name="domain"
          defaultValue={defaults?.domain ?? "company"}
          className="min-h-11 rounded-md border border-slate-200 bg-white px-3 py-2 font-normal"
        >
          {domains.map((domain) => (
            <option key={domain.value} value={domain.value}>
              {domain.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        Titre
        <input
          required
          name="title"
          minLength={3}
          maxLength={120}
          defaultValue={defaults?.title}
          className="min-h-11 rounded-md border border-slate-200 px-3 py-2 font-normal"
        />
      </label>
      <label className={compact ? "grid gap-1 text-sm font-semibold text-slate-700" : "grid gap-1 text-sm font-semibold text-slate-700 md:col-span-2"}>
        Résumé
        <textarea
          required
          name="summary"
          minLength={5}
          maxLength={1000}
          rows={3}
          defaultValue={defaults?.summary}
          className="rounded-md border border-slate-200 px-3 py-2 font-normal"
        />
      </label>
      <label className={compact ? "grid gap-1 text-sm font-semibold text-slate-700" : "grid gap-1 text-sm font-semibold text-slate-700 md:col-span-2"}>
        Détails
        <textarea
          name="details"
          maxLength={5000}
          rows={3}
          defaultValue={defaults?.details}
          className="rounded-md border border-slate-200 px-3 py-2 font-normal"
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        Confiance
        <input
          required
          type="number"
          name="confidence"
          min={0}
          max={100}
          step={1}
          defaultValue={defaults?.confidence ?? 80}
          className="min-h-11 rounded-md border border-slate-200 px-3 py-2 font-normal"
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        Type de preuve
        <select
          name="evidenceType"
          defaultValue="observation"
          className="min-h-11 rounded-md border border-slate-200 bg-white px-3 py-2 font-normal"
        >
          {evidenceTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </label>
      <label className={compact ? "grid gap-1 text-sm font-semibold text-slate-700" : "grid gap-1 text-sm font-semibold text-slate-700 md:col-span-2"}>
        Preuve ou constat
        <textarea
          required
          name="evidenceSummary"
          minLength={5}
          maxLength={500}
          rows={2}
          className="rounded-md border border-slate-200 px-3 py-2 font-normal"
        />
      </label>
      <label className={compact ? "grid gap-1 text-sm font-semibold text-slate-700" : "grid gap-1 text-sm font-semibold text-slate-700 md:col-span-2"}>
        Référence
        <input
          name="sourceRef"
          maxLength={500}
          defaultValue={defaults?.sourceRef}
          className="min-h-11 rounded-md border border-slate-200 px-3 py-2 font-normal"
        />
      </label>
    </div>
  );
}

function Signal({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-h-24 rounded-lg bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

function CoverageStatus({
  status,
}: {
  status: "complete" | "partial" | "missing";
}) {
  if (status === "complete") {
    return <CheckCircle2 className="shrink-0 text-emerald-600" size={20} aria-label="Complet" />;
  }
  if (status === "partial") {
    return <CheckCircle2 className="shrink-0 text-amber-600" size={20} aria-label="Partiel" />;
  }
  return <TriangleAlert className="shrink-0 text-slate-400" size={20} aria-label="À compléter" />;
}

function domainLabel(domain: BusinessBrainDomain) {
  return domains.find((item) => item.value === domain)?.label ?? domain;
}

function formatCurrency(valueCents: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(valueCents / 100);
}
