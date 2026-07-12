import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  Contact,
  Globe2,
  PlugZap,
  Sparkles,
  Target,
  Workflow,
} from "lucide-react";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const dashboard = await services.getDashboard(user.id, tenant.id);

  const metrics = [
    {
      label: "Nouveaux leads",
      value: dashboard.metrics.newLeads,
      icon: Target,
      href: "/contacts",
      detail: "À traiter rapidement",
    },
    {
      label: "Contacts",
      value: dashboard.metrics.contacts,
      icon: Contact,
      href: "/contacts",
      detail: "Base commerciale active",
    },
    {
      label: "Relances à faire",
      value: dashboard.metrics.pendingTasks,
      icon: ClipboardList,
      href: "/automatisations",
      detail: "Actions en attente",
    },
    {
      label: "Statut du site",
      value: dashboard.websiteStatus,
      icon: Globe2,
      href: "/mon-site",
      detail: "Visibilité en ligne",
    },
  ];

  const priorityActions = [
    ...(dashboard.metrics.newLeads > 0
      ? [
          {
            title: `Qualifier ${dashboard.metrics.newLeads} nouveau${dashboard.metrics.newLeads > 1 ? "x" : ""} lead${dashboard.metrics.newLeads > 1 ? "s" : ""}`,
            description: "Répondez tant que l'intention est encore chaude.",
            href: "/contacts",
            icon: Target,
            tone: "urgent",
          },
        ]
      : []),
    ...(dashboard.metrics.pendingTasks > 0
      ? [
          {
            title: `Traiter ${dashboard.metrics.pendingTasks} relance${dashboard.metrics.pendingTasks > 1 ? "s" : ""}`,
            description: "Gardez le pipeline en mouvement sans laisser de prospect refroidir.",
            href: "/automatisations",
            icon: Workflow,
            tone: "warning",
          },
        ]
      : []),
    ...(dashboard.websiteStatus !== "published"
      ? [
          {
            title: "Finaliser et publier le site",
            description: "Votre vitrine doit être en ligne pour capter les demandes locales.",
            href: "/mon-site",
            icon: Globe2,
            tone: "info",
          },
        ]
      : []),
    ...(dashboard.connectorHealth.some((connector) => connector.health !== "healthy")
      ? [
          {
            title: "Vérifier les connexions",
            description: "Une source de données mal connectée peut faire perdre des opportunités.",
            href: "/connexions",
            icon: PlugZap,
            tone: "neutral",
          },
        ]
      : []),
  ].slice(0, 4);

  const allClear = priorityActions.length === 0;

  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#0b8f84]">
            Centre de pilotage
          </p>
          <h1 className="mt-1 text-4xl font-bold tracking-tight text-slate-950">
            Bonjour {user.name.split(" ")[0]}, voici l'essentiel.
          </h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Les priorités commerciales et digitales de {dashboard.tenant.name}, réunies au même endroit.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/opportunites"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-900 shadow-sm transition hover:border-slate-400"
          >
            Voir le pipeline
            <ArrowRight size={17} aria-hidden />
          </Link>
          <Link
            href="/mon-site"
            className="inline-flex items-center gap-2 rounded-md bg-[#08111f] px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            Gérer le site
            <Globe2 size={17} aria-hidden />
          </Link>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Link
              key={metric.label}
              href={metric.href}
              className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#19c6b7] hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-10 place-items-center rounded-lg bg-[#e8fbf8] text-[#0b8f84]">
                  <Icon size={20} aria-hidden />
                </span>
                <ArrowRight
                  size={18}
                  className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#0b8f84]"
                  aria-hidden
                />
              </div>
              <p className="mt-5 text-sm font-medium text-slate-500">{metric.label}</p>
              <p className="mt-1 text-3xl font-bold tracking-tight">{metric.value}</p>
              <p className="mt-2 text-xs text-slate-500">{metric.detail}</p>
            </Link>
          );
        })}
      </section>

      <section className="rounded-xl bg-[#08111f] p-5 text-white shadow-sm lg:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[#6fe2d7]">
              <Sparkles size={18} aria-hidden />
              <p className="text-sm font-semibold uppercase tracking-[0.14em]">Plan d'action recommandé</p>
            </div>
            <h2 className="mt-2 text-2xl font-bold">Ce qui mérite votre attention maintenant</h2>
          </div>
          <Link
            href="/automatisations"
            className="inline-flex w-fit items-center gap-2 rounded-md bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
          >
            Voir les automatisations
            <ArrowRight size={16} aria-hidden />
          </Link>
        </div>

        {allClear ? (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-4">
            <CheckCircle2 className="mt-0.5 text-emerald-300" size={21} aria-hidden />
            <div>
              <p className="font-semibold">Tout est sous contrôle.</p>
              <p className="mt-1 text-sm text-white/65">
                Aucun point critique détecté. Profitez-en pour développer votre visibilité ou enrichir votre base clients.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {priorityActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.title}
                  href={action.href}
                  className="group rounded-lg border border-white/10 bg-white/5 p-4 transition hover:border-[#19c6b7]/60 hover:bg-white/10"
                >
                  <Icon size={20} className="text-[#6fe2d7]" aria-hidden />
                  <p className="mt-4 font-semibold">{action.title}</p>
                  <p className="mt-2 text-sm leading-5 text-white/60">{action.description}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#6fe2d7]">
                    Agir maintenant
                    <ArrowRight size={15} className="transition group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#0b8f84]">Détection intelligente</p>
              <h2 className="mt-1 text-xl font-bold">Opportunités détectées</h2>
            </div>
            <Link href="/opportunites" className="text-sm font-semibold text-slate-600 hover:text-slate-950">
              Tout voir
            </Link>
          </div>
          <div className="mt-4 grid gap-3">
            {dashboard.detectedOpportunities.length > 0 ? (
              dashboard.detectedOpportunities.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                >
                  <CircleAlert size={18} className="mt-0.5 shrink-0" aria-hidden />
                  <span>{item}</span>
                </div>
              ))
            ) : (
              <p className="rounded-lg bg-slate-50 px-4 py-5 text-sm text-slate-500">
                Aucune opportunité particulière détectée pour le moment.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#0b8f84]">Flux de données</p>
              <h2 className="mt-1 text-xl font-bold">Santé des connexions</h2>
            </div>
            <Link href="/connexions" className="text-sm font-semibold text-slate-600 hover:text-slate-950">
              Configurer
            </Link>
          </div>
          <div className="mt-4 grid gap-3">
            {dashboard.connectorHealth.slice(0, 4).map((connector) => {
              const healthy = connector.health === "healthy";
              return (
                <div
                  key={connector.key}
                  className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{connector.name}</p>
                    <p className="truncate text-sm text-slate-500">{connector.status}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      healthy
                        ? "bg-emerald-100 text-emerald-800"
                        : connector.health === "warning"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {healthy ? "Opérationnel" : connector.health === "warning" ? "À vérifier" : "Inactif"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Pipeline commercial</h2>
            <Link href="/opportunites" className="text-sm font-semibold text-slate-600 hover:text-slate-950">
              Ouvrir
            </Link>
          </div>
          <div className="mt-5 grid gap-4">
            {dashboard.opportunitiesByStage.map((stage) => {
              const maxCount = Math.max(...dashboard.opportunitiesByStage.map((item) => item.count), 1);
              return (
                <div key={stage.stage} className="grid gap-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">{stage.stage}</span>
                    <strong>{stage.count}</strong>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-[#19c6b7]"
                      style={{ width: `${Math.max(stage.count > 0 ? 8 : 0, (stage.count / maxCount) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Activité récente</h2>
            <Link href="/mon-activite" className="text-sm font-semibold text-slate-600 hover:text-slate-950">
              Historique
            </Link>
          </div>
          <div className="mt-4 grid gap-3">
            {dashboard.recentActivities.length > 0 ? (
              dashboard.recentActivities.map((activity) => (
                <div key={activity.id} className="rounded-lg border border-slate-200 px-4 py-3">
                  <p className="font-semibold">{activity.summary}</p>
                  <p className="mt-1 text-sm text-slate-500">{activity.type}</p>
                </div>
              ))
            ) : (
              <p className="rounded-lg bg-slate-50 px-4 py-5 text-sm text-slate-500">
                L'activité apparaîtra ici à mesure que vous utilisez TRADIKOM ONE.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[#0b8f84]">Automatisation</p>
            <h2 className="mt-1 text-xl font-bold">Dernières exécutions</h2>
          </div>
          <Link href="/automatisations" className="text-sm font-semibold text-slate-600 hover:text-slate-950">
            Tout gérer
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {dashboard.workflowRuns.length > 0 ? (
            dashboard.workflowRuns.map((run) => (
              <div key={run.id} className="rounded-lg border border-slate-200 px-4 py-3">
                <p className="font-semibold">{run.summary}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {run.triggerName} · {run.status}
                </p>
              </div>
            ))
          ) : (
            <p className="rounded-lg bg-slate-50 px-4 py-5 text-sm text-slate-500 md:col-span-2">
              Aucune automatisation exécutée pour le moment.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
