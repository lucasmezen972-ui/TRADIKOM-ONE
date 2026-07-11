import Link from "next/link";
import { ArrowDown, ArrowUp, Eye, RotateCcw, Save, Send } from "lucide-react";
import {
  moveSectionAction,
  publishWebsiteAction,
  restoreVersionAction,
  updateSectionAction,
} from "@/app/actions";
import { SiteRenderer } from "@/components/site-renderer";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function WebsitePage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const workspace = await services.getWebsiteWorkspace(user.id, tenant.id);

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
