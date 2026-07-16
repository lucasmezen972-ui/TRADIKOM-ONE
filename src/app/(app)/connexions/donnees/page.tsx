import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Database,
  Download,
  FileOutput,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  cancelUniversalExportAction,
  commitUniversalImportAction,
  rollbackUniversalImportAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import { UniversalExportForm } from "./export-form";
import { UniversalImportForm } from "./import-form";

export const dynamic = "force-dynamic";

const entityLabels: Record<string, string> = {
  contacts: "Contacts",
  companies: "Entreprises",
  products: "Produits",
  opportunities: "Opportunités",
  tasks: "Tâches",
  activities: "Activités",
  workflows: "Automatisations",
  connector_health: "Santé des connecteurs",
};

const importStatusLabels: Record<string, string> = {
  validated: "Aperçu validé",
  processing: "Finalisation en cours",
  completed: "Import terminé",
  rolled_back: "Import annulé",
};

const exportStatusLabels: Record<string, string> = {
  queued: "En attente de génération",
  processing: "Génération en cours",
  completed: "Fichier disponible",
  failed: "Génération échouée",
  cancelled: "Export annulé",
  expired: "Fichier expiré",
};

export default async function DataConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ import?: string; export?: string }>;
}) {
  const params = await searchParams;
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const [importWorkspace, exportWorkspace] = await Promise.all([
    services.getImportWorkspace(user.id, tenant.id),
    services.getExportWorkspace(user.id, tenant.id),
  ]);
  const selected = importWorkspace.jobs.find((job) => job.id === params.import);
  const selectedExport = exportWorkspace.jobs.find((job) => job.id === params.export);
  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1_000);

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
            Échanges de données
          </p>
          <h1 className="mt-1 text-3xl font-bold">Imports et exports</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Contrôlez les colonnes avant import et préparez des fichiers temporaires sans champs techniques sensibles.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-md bg-[#e6fffb] px-3 py-2 text-xs font-semibold text-[#075e57]">
          <ShieldCheck size={16} aria-hidden />
          Validation à blanc obligatoire
        </span>
      </header>

      {importWorkspace.canManage ? (
        <section>
          <h2 className="text-xl font-bold">Nouvel import</h2>
          <UniversalImportForm />
        </section>
      ) : (
        <section className="border-y border-slate-200 py-5 text-sm text-slate-600">
          Seuls le propriétaire, les administrateurs et les responsables peuvent importer des données.
        </section>
      )}

      {selected ? (
        <section className="rounded-lg border border-[#99f6e4] bg-[#f0fdfa] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#075e57]">Dernier aperçu</p>
              <h2 className="mt-1 text-xl font-bold">{selected.fileName}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {entityLabels[selected.entityType]} · {selected.format.toUpperCase()} · {importStatusLabels[selected.status] ?? selected.status}
              </p>
            </div>
            <CheckCircle2 className="text-[#0f766e]" size={24} aria-hidden />
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <Metric label="Lignes" value={selected.report.total ?? 0} />
            <Metric label="Valides" value={selected.report.valid ?? 0} />
            <Metric label="Doublons" value={selected.report.duplicates ?? 0} />
            <Metric label="Invalides" value={selected.report.invalid ?? 0} />
            <Metric label="Importées" value={selected.report.imported ?? 0} />
          </dl>
          {selected.rows.some((row) => row.status !== "valid" && row.status !== "imported") ? (
            <div className="mt-5 border-t border-teal-100 pt-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle size={16} aria-hidden />
                Lignes à contrôler
              </p>
              <ul className="mt-2 grid gap-1 text-sm text-slate-600">
                {selected.rows
                  .filter((row) => row.status !== "valid" && row.status !== "imported")
                  .map((row) => (
                    <li key={row.id}>Ligne {row.rowNumber} : {row.error ?? row.status}</li>
                  ))}
              </ul>
            </div>
          ) : null}
          {importWorkspace.canManage ? (
            <div className="mt-5 flex flex-wrap gap-3 border-t border-teal-100 pt-4">
              {["validated", "processing"].includes(selected.status) ? (
                <form action={commitUniversalImportAction}>
                  <input type="hidden" name="importId" value={selected.id} />
                  <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                    <Database size={16} aria-hidden />
                    {selected.status === "processing" ? "Continuer la finalisation" : "Finaliser l’import"}
                  </button>
                </form>
              ) : null}
              {["processing", "completed"].includes(selected.status) && (selected.report.imported ?? 0) > 0 ? (
                <form action={rollbackUniversalImportAction}>
                  <input type="hidden" name="importId" value={selected.id} />
                  <button className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50">
                    <RotateCcw size={16} aria-hidden />
                    Annuler les données importées
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="grid gap-4">
        <div className="flex items-center gap-3">
          <Database size={20} aria-hidden />
          <h2 className="text-xl font-bold">Historique</h2>
        </div>
        {importWorkspace.jobs.length === 0 ? (
          <div className="border-y border-slate-200 py-8 text-sm text-slate-600">
            Aucun import contrôlé n’a encore été préparé.
          </div>
        ) : (
          <div className="grid gap-3">
            {importWorkspace.jobs.map((job) => (
              <Link
                key={job.id}
                href={`/connexions/donnees?import=${encodeURIComponent(job.id)}`}
                className="grid gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-400 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div>
                  <h3 className="font-bold">{job.fileName}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {entityLabels[job.entityType]} · {job.format.toUpperCase()} · {job.report.total ?? 0} lignes
                  </p>
                </div>
                <span className="self-start rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                  {importStatusLabels[job.status] ?? job.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {exportWorkspace.canManage ? (
        <section>
          <h2 className="text-xl font-bold">Nouvel export</h2>
          <UniversalExportForm
            defaultDateFrom={thirtyDaysAgo.toISOString().slice(0, 10)}
            defaultDateTo={today.toISOString().slice(0, 10)}
          />
        </section>
      ) : (
        <section className="border-y border-slate-200 py-5 text-sm text-slate-600">
          Seuls le propriétaire, les administrateurs et les responsables peuvent exporter des données.
        </section>
      )}

      {selectedExport ? (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#075e57]">Export sélectionné</p>
              <h2 className="mt-1 text-xl font-bold">
                {entityLabels[selectedExport.entityType]} · {selectedExport.format.toUpperCase()}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {exportStatusLabels[selectedExport.status] ?? selectedExport.status} · {selectedExport.rowCount} lignes
              </p>
            </div>
            <FileOutput size={24} className="text-[#0f766e]" aria-hidden />
          </div>
          {selectedExport.status === "failed" ? (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
              La génération a échoué de façon sûre. Aucun fichier partiel n’est disponible.
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-3 border-t border-slate-100 pt-4">
            {selectedExport.status === "completed" ? (
              <Link
                href={`/api/exports/${encodeURIComponent(selectedExport.id)}`}
                className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <Download size={16} aria-hidden />
                Télécharger le fichier
              </Link>
            ) : null}
            {["queued", "processing", "completed"].includes(selectedExport.status) && exportWorkspace.canManage ? (
              <form action={cancelUniversalExportAction}>
                <input type="hidden" name="exportId" value={selectedExport.id} />
                <button className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50">
                  <XCircle size={16} aria-hidden />
                  Annuler et supprimer le fichier
                </button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="grid gap-4">
        <div className="flex items-center gap-3">
          <FileOutput size={20} aria-hidden />
          <h2 className="text-xl font-bold">Exports récents</h2>
        </div>
        {exportWorkspace.jobs.length === 0 ? (
          <div className="border-y border-slate-200 py-8 text-sm text-slate-600">
            Aucun export n’a encore été demandé.
          </div>
        ) : (
          <div className="grid gap-3">
            {exportWorkspace.jobs.map((job) => (
              <Link
                key={job.id}
                href={`/connexions/donnees?export=${encodeURIComponent(job.id)}`}
                className="grid gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-400 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div>
                  <h3 className="font-bold">{entityLabels[job.entityType]} · {job.format.toUpperCase()}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {job.rowCount} lignes · expiration {new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(job.expiresAt))}
                  </p>
                </div>
                <span className="self-start rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                  {exportStatusLabels[job.status] ?? job.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 text-xl font-bold">{value}</dd>
    </div>
  );
}
