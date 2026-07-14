import {
  Bot,
  Boxes,
  CheckCircle2,
  LockKeyhole,
  PackageSearch,
  RefreshCw,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import {
  previewPrivateMarketplaceInstallationAction,
  refreshPrivateAppMarketplaceAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import type { MarketplaceCategory } from "@/modules/app-marketplace";

export const dynamic = "force-dynamic";

export default async function PrivateMarketplacePage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const workspace = await services.getPrivateAppMarketplace(user.id, tenant.id);
  const counts = new Map<MarketplaceCategory, number>([
    ["connector", 0],
    ["workflow", 0],
    ["ai_employee", 0],
  ]);
  for (const listing of workspace.listings) {
    counts.set(listing.category, (counts.get(listing.category) ?? 0) + 1);
  }

  return (
    <div className="grid gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            App Marketplace
          </p>
          <h1 className="mt-1 text-4xl font-bold">Catalogue privé</h1>
        </div>
        {workspace.canManage ? (
          <form action={refreshPrivateAppMarketplaceAction}>
            <button className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
              <RefreshCw size={18} aria-hidden />
              Actualiser le catalogue
            </button>
          </form>
        ) : null}
      </header>

      <div className="flex items-start gap-3 rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
        <LockKeyhole className="mt-0.5 shrink-0" size={19} aria-hidden />
        <p>
          Ce catalogue reste strictement privé à votre organisation. Il prépare
          uniquement des aperçus : aucune installation, activation, exécution,
          publication, communication externe ou transaction n&apos;est disponible.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Contenu du catalogue privé">
        <Summary icon={Boxes} label="Connecteurs" value={counts.get("connector") ?? 0} />
        <Summary icon={Workflow} label="Workflows" value={counts.get("workflow") ?? 0} />
        <Summary icon={Bot} label="Collègues IA" value={counts.get("ai_employee") ?? 0} />
      </section>

      {workspace.listings.length === 0 ? (
        <section className="border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
          <PackageSearch className="mx-auto text-slate-400" size={32} aria-hidden />
          <h2 className="mt-3 text-xl font-bold">Aucune fiche privée préparée</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-500">
            Un responsable peut actualiser le catalogue à partir des connecteurs
            sandbox validés, des workflows actifs et des profils IA existants.
          </p>
        </section>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2" aria-label="Fiches privées">
          {workspace.listings.map((listing) => (
            <article key={listing.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                    {categoryLabels[listing.category]}
                  </span>
                  <h2 className="mt-3 text-xl font-bold">{listing.title}</h2>
                  <p className="mt-1 text-sm text-slate-600">{listing.summary}</p>
                </div>
                <span className="rounded-md bg-[#e6fffb] px-2 py-1 text-xs font-semibold text-[#075e57]">
                  Privé · v{listing.version}
                </span>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Detail title="Provenance">
                  <li>{sourceLabels[listing.sourceKind]}</li>
                  <li>Version source {String(listing.provenance.sourceVersion ?? "vérifiée")}</li>
                </Detail>
                <Detail title="Sécurité">
                  <li>Approbation humaine requise</li>
                  <li>Exécution externe interdite</li>
                </Detail>
              </div>

              <div className="mt-4">
                <p className="text-sm font-semibold">Capacités déclarées</p>
                <p className="mt-1 text-sm text-slate-600">
                  {listing.capabilities.length} capacité(s) issue(s) de la source versionnée.
                </p>
              </div>

              <div className="mt-5 border-t border-slate-100 pt-4">
                {listing.preview ? (
                  <div className="grid gap-3">
                    <p className="inline-flex items-center gap-2 text-sm font-semibold text-[#075e57]">
                      <CheckCircle2 size={17} aria-hidden />
                      Aperçu d&apos;installation prêt, désactivé
                    </p>
                    <ol className="grid gap-1 text-sm text-slate-600">
                      {listing.preview.steps.map((step, index) => (
                        <li key={step}>{index + 1}. {step}</li>
                      ))}
                    </ol>
                    <p className="text-xs font-semibold text-amber-800">
                      {listing.preview.blockers[0]}
                    </p>
                  </div>
                ) : workspace.canManage ? (
                  <form action={previewPrivateMarketplaceInstallationAction}>
                    <input type="hidden" name="listingId" value={listing.id} />
                    <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white">
                      <ShieldCheck size={16} aria-hidden />
                      Prévisualiser l&apos;installation
                    </button>
                  </form>
                ) : (
                  <p className="text-sm text-slate-500">
                    Aperçu réservé aux responsables de l&apos;organisation.
                  </p>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="border-t border-slate-200 pt-5">
        <h2 className="text-lg font-bold">Catégories en attente de source validée</h2>
        <p className="mt-2 text-sm text-slate-600">
          Modèles de site, tableaux de bord et rapports ne sont pas inventés : ils
          apparaîtront uniquement lorsqu&apos;un artefact versionné et approuvé existera.
        </p>
      </section>
    </div>
  );
}

const categoryLabels: Record<MarketplaceCategory, string> = {
  connector: "Connecteur",
  workflow: "Workflow",
  ai_employee: "Collègue IA",
};

const sourceLabels = {
  connector_plan: "Plan connecteur sandbox validé",
  workflow: "Définition de workflow active",
  ai_employee_profile: "Profil IA versionné",
};

function Summary({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Boxes;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between border border-slate-200 bg-white px-4 py-4">
      <div>
        <p className="text-sm text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
      </div>
      <Icon className="text-teal-700" size={22} aria-hidden />
    </div>
  );
}

function Detail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{title}</p>
      <ul className="mt-2 grid gap-1 text-sm text-slate-700">{children}</ul>
    </div>
  );
}
