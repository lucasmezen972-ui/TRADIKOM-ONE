import {
  CheckCircle2,
  FileLock2,
  LibraryBig,
  PackagePlus,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import {
  createPrivateAutomationPackageAction,
  previewPrivateAutomationPackageAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AutomationMarketplacePage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const workspace = await services.getAutomationMarketplace(user.id, tenant.id);

  return (
    <div className="grid gap-7">
      <header>
        <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
          Automation Marketplace
        </p>
        <h1 className="mt-1 text-4xl font-bold">Bibliothèque d&apos;automatisations</h1>
      </header>

      <div className="flex items-start gap-3 rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
        <FileLock2 className="mt-0.5 shrink-0" size={19} aria-hidden />
        <p>
          Les paquets restent privés à votre organisation. Les valeurs d&apos;entrée
          ne sont jamais copiées et aucun workflow ne peut être importé, activé,
          exécuté, publié ou envoyé depuis cette bibliothèque.
        </p>
      </div>

      <section>
        <div className="flex items-center gap-2">
          <Workflow size={20} className="text-teal-700" aria-hidden />
          <h2 className="text-xl font-bold">Sources disponibles</h2>
        </div>
        {workspace.sources.length === 0 ? (
          <div className="mt-3 border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-600">
            Aucun workflow actif n&apos;est disponible dans le catalogue privé.
          </div>
        ) : (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {workspace.sources.map((source) => (
              <article key={source.listingId} className="border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold">{source.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      Déclencheur : {source.trigger} · source v{source.listingVersion}
                    </p>
                  </div>
                  {source.packaged ? (
                    <span className="rounded-md bg-[#e6fffb] px-2 py-1 text-xs font-semibold text-[#075e57]">
                      Paquet préparé
                    </span>
                  ) : workspace.canManage ? (
                    <form action={createPrivateAutomationPackageAction}>
                      <input type="hidden" name="listingId" value={source.listingId} />
                      <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white">
                        <PackagePlus size={16} aria-hidden />
                        Préparer le paquet privé
                      </button>
                    </form>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center gap-2">
          <LibraryBig size={20} className="text-teal-700" aria-hidden />
          <h2 className="text-xl font-bold">Paquets privés</h2>
        </div>
        {workspace.packages.length === 0 ? (
          <div className="mt-3 border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-600">
            Aucun paquet d&apos;automatisation n&apos;a encore été préparé.
          </div>
        ) : (
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {workspace.packages.map((automationPackage) => {
              const actions = Array.isArray(automationPackage.template.actions)
                ? automationPackage.template.actions
                : [];
              return (
                <article key={automationPackage.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold">{automationPackage.title}</h3>
                      <p className="mt-1 text-sm text-slate-600">{automationPackage.summary}</p>
                    </div>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold">
                      Privé · v{automationPackage.version}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="font-semibold">Structure sûre</p>
                      <p className="mt-1 text-slate-600">
                        {actions.length} étape(s) · valeurs source exclues
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold">Configuration requise</p>
                      <p className="mt-1 text-slate-600">
                        {automationPackage.requiredConfiguration.length === 0
                          ? "Aucun champ déclaré"
                          : automationPackage.requiredConfiguration.join(", ")}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 border-t border-slate-100 pt-4">
                    {automationPackage.preview ? (
                      <div className="grid gap-2">
                        <p className="inline-flex items-center gap-2 text-sm font-semibold text-[#075e57]">
                          <CheckCircle2 size={17} aria-hidden />
                          Aperçu du paquet prêt, exécution désactivée
                        </p>
                        <p className="text-xs font-semibold text-amber-800">
                          {automationPackage.preview.blockers[0]}
                        </p>
                      </div>
                    ) : workspace.canManage ? (
                      <form action={previewPrivateAutomationPackageAction}>
                        <input type="hidden" name="packageId" value={automationPackage.id} />
                        <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white">
                          <ShieldCheck size={16} aria-hidden />
                          Prévisualiser le paquet
                        </button>
                      </form>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
