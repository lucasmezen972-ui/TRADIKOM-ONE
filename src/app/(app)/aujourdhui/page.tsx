import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Globe2,
  ShieldAlert,
  Target,
} from "lucide-react";
import type { ReactNode } from "react";
import type { DashboardActionItem } from "@/lib/types";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const dashboard = await services.getDashboard(user.id, tenant.id);
  const commandCenter = dashboard.commandCenter;

  const metrics = [
    {
      label: "Nouveaux leads",
      value: dashboard.metrics.newLeads,
      detail: "Reçus aujourd'hui",
      href: "/contacts",
      icon: Target,
    },
    {
      label: "Tâches en retard",
      value: dashboard.metrics.overdueTasks,
      detail: "Actions échues",
      href: "/contacts",
      icon: Clock3,
    },
    {
      label: "Opportunités à relancer",
      value: dashboard.metrics.opportunitiesNeedingFollowUp,
      detail: "Échéance aujourd'hui ou dépassée",
      href: "/opportunites",
      icon: ClipboardCheck,
    },
    {
      label: "Incidents actifs",
      value:
        dashboard.metrics.workflowFailures +
        dashboard.metrics.deadLetters +
        dashboard.metrics.connectorIssues +
        dashboard.metrics.apiSourceFailures,
      detail: "Workflows, connecteurs et sources",
      href: "/automatisations",
      icon: AlertTriangle,
    },
  ];

  return (
    <div className="grid gap-8">
      <header className="flex flex-col gap-4 border-b border-slate-300 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-[#0b8f84]">
            Aujourd&apos;hui
          </p>
          <h1 className="mt-1 text-4xl font-bold text-slate-950">
            Priorités de {dashboard.tenant.name}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Mise à jour à {formatTime(commandCenter.capturedAt, commandCenter.timeZone)}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <CommandLink href="/opportunites">Ouvrir le pipeline</CommandLink>
          <CommandLink href="/mon-site" primary>Gérer le site</CommandLink>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicateurs opérationnels">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Link
              key={metric.label}
              href={metric.href}
              className="group rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-[#0b8f84]"
            >
              <div className="flex items-start justify-between">
                <Icon size={20} className="text-[#0b8f84]" aria-hidden />
                <ArrowRight size={17} className="text-slate-400 group-hover:text-[#0b8f84]" aria-hidden />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-600">{metric.label}</p>
              <p className="mt-1 text-3xl font-bold">{metric.value}</p>
              <p className="mt-2 text-xs text-slate-500">{metric.detail}</p>
            </Link>
          );
        })}
      </section>

      <section className="bg-[#08111f] px-5 py-6 text-white lg:px-7" aria-labelledby="priorities-title">
        <div className="flex items-center gap-3">
          <ShieldAlert className="text-[#6fe2d7]" size={22} aria-hidden />
          <div>
            <p className="text-sm font-semibold text-[#6fe2d7]">Plan d&apos;action</p>
            <h2 id="priorities-title" className="text-2xl font-bold">À traiter en priorité</h2>
          </div>
        </div>
        {commandCenter.priorityActions.length > 0 ? (
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {commandCenter.priorityActions.map((action) => (
              <ActionCard key={action.id} action={action} dark />
            ))}
          </div>
        ) : (
          <div className="mt-5 flex items-start gap-3 border border-emerald-300/25 bg-emerald-300/10 p-4">
            <CheckCircle2 size={20} className="mt-0.5 text-emerald-300" aria-hidden />
            <div>
              <p className="font-semibold">Aucune priorité critique.</p>
              <p className="mt-1 text-sm text-white/65">Les files opérationnelles sont à jour.</p>
            </div>
          </div>
        )}
      </section>

      <OperationalSection
        title="Suivi commercial"
        description="Leads, tâches et opportunités qui demandent une action aujourd'hui."
      >
        <ActionColumn title="Tâches en retard" items={commandCenter.overdueTasks} empty="Aucune tâche en retard." />
        <ActionColumn title="Nouveaux leads" items={commandCenter.newLeads} empty="Aucun nouveau lead aujourd'hui." />
        <ActionColumn
          title="Opportunités à relancer"
          items={commandCenter.opportunitiesNeedingFollowUp}
          empty="Aucune relance commerciale attendue aujourd'hui."
        />
      </OperationalSection>

      <OperationalSection
        title="Opportunity Radar"
        description="Alertes actives issues des règles métier de cette organisation."
      >
        <ActionColumn
          title="Alertes actives"
          items={dashboard.detectedOpportunities.map((alert) => ({
            id: alert.id,
            title: alert.title,
            explanation: alert.explanation,
            actionLabel: alert.actionLabel,
            actionHref: alert.actionHref,
            severity: alert.severity,
          }))}
          empty="Aucune alerte Opportunity Radar active."
          wide
        />
      </OperationalSection>

      <OperationalSection
        title="Automatisations"
        description="Échecs terminaux et événements placés en dead letter."
      >
        <ActionColumn title="Workflows en échec" items={commandCenter.workflowFailures} empty="Aucun workflow en échec." />
        <ActionColumn title="Dead letters" items={commandCenter.deadLetters} empty="Aucun événement en dead letter." />
      </OperationalSection>

      <OperationalSection
        title="Connecteurs et Intelligence API"
        description="État des connexions, sources officielles et changements bloquants."
      >
        <div className="grid gap-3">
          <h3 className="font-bold">Santé des connecteurs</h3>
          {dashboard.connectorHealth.length > 0 ? dashboard.connectorHealth.map((connector) => (
            <Link
              key={connector.key}
              href="/connexions"
              className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold">{connector.name}</p>
                <p className="truncate text-sm text-slate-500">{connector.status}</p>
              </div>
              <StatusLabel status={connector.health} />
            </Link>
          )) : <EmptyState>Aucun connecteur configuré.</EmptyState>}
        </div>
        <ActionColumn title="Relectures de sources" items={commandCenter.apiSourceFailures} empty="Aucune relecture de source en échec." />
        <ActionColumn title="Changements API" items={commandCenter.breakingApiChanges} empty="Aucun changement API bloquant." />
      </OperationalSection>

      <OperationalSection
        title="Approbations et publication"
        description="Décisions autorisées et état de la vitrine publique."
      >
        <ActionColumn title="Approbations en attente" items={commandCenter.pendingApprovals} empty="Aucune approbation visible pour votre rôle." />
        <div className="grid gap-3">
          <h3 className="font-bold">Site web</h3>
          <Link href="/mon-site" className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{commandCenter.website.label}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {commandCenter.website.hasUnpublishedChanges
                    ? "Des changements non publiés attendent une vérification."
                    : commandCenter.website.status === "published"
                      ? "La dernière version publiée reste en ligne."
                      : "La vitrine publique n'est pas encore disponible."}
                </p>
              </div>
              <Globe2 className="shrink-0 text-[#0b8f84]" size={21} aria-hidden />
            </div>
          </Link>
        </div>
      </OperationalSection>

      <OperationalSection
        title="Activité récente"
        description="Derniers événements métier enregistrés pour cette organisation."
      >
        <div className="grid gap-3 lg:col-span-3">
          {dashboard.recentActivities.length > 0 ? dashboard.recentActivities.map((activity) => (
            <div key={activity.id} className="flex items-start gap-3 border-b border-slate-200 pb-3">
              <Activity size={18} className="mt-0.5 text-[#0b8f84]" aria-hidden />
              <div>
                <p className="font-semibold">{activity.summary}</p>
                <p className="mt-1 text-sm text-slate-500">{activity.type}</p>
              </div>
            </div>
          )) : <EmptyState>Aucune activité récente.</EmptyState>}
        </div>
      </OperationalSection>
    </div>
  );
}

function OperationalSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-slate-300 pt-6">
      <div className="mb-5">
        <h2 className="text-2xl font-bold">{title}</h2>
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function ActionColumn({
  title,
  items,
  empty,
  wide = false,
}: {
  title: string;
  items: DashboardActionItem[];
  empty: string;
  wide?: boolean;
}) {
  return (
    <div className={`grid content-start gap-3 ${wide ? "lg:col-span-3" : ""}`}>
      <h3 className="font-bold">{title}</h3>
      {items.length > 0
        ? items.map((item) => <ActionCard key={item.id} action={item} />)
        : <EmptyState>{empty}</EmptyState>}
    </div>
  );
}

function ActionCard({ action, dark = false }: { action: DashboardActionItem; dark?: boolean }) {
  return (
    <Link
      href={action.actionHref}
      className={`group rounded-lg border p-4 transition ${
        dark
          ? "border-white/10 bg-white/5 hover:border-[#6fe2d7]"
          : "border-slate-200 bg-white hover:border-[#0b8f84]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">{action.title}</p>
        <SeverityDot severity={action.severity} />
      </div>
      <p className={`mt-2 text-sm ${dark ? "text-white/65" : "text-slate-600"}`}>
        {action.explanation}
      </p>
      <span className={`mt-4 inline-flex items-center gap-1 text-sm font-semibold ${dark ? "text-[#6fe2d7]" : "text-[#0b8f84]"}`}>
        {action.actionLabel}
        <ArrowRight size={15} className="group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">{children}</p>;
}

function CommandLink({ children, href, primary = false }: { children: ReactNode; href: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 rounded-md px-4 py-3 font-semibold ${
        primary ? "bg-[#08111f] text-white" : "border border-slate-300 bg-white text-slate-950"
      }`}
    >
      {children}
      <ArrowRight size={16} aria-hidden />
    </Link>
  );
}

function SeverityDot({ severity }: { severity: DashboardActionItem["severity"] }) {
  const className = severity === "critical" ? "bg-red-500" : severity === "warning" ? "bg-amber-500" : "bg-sky-500";
  return <span className={`mt-1 size-2.5 shrink-0 rounded-full ${className}`} aria-label={severity === "critical" ? "Critique" : severity === "warning" ? "Attention" : "Information"} />;
}

function StatusLabel({ status }: { status: "healthy" | "warning" | "error" | "inactive" }) {
  const label = status === "healthy" ? "Opérationnel" : status === "warning" ? "À vérifier" : status === "error" ? "Erreur" : "Inactif";
  const className = status === "healthy" ? "bg-emerald-100 text-emerald-800" : status === "warning" ? "bg-amber-100 text-amber-800" : status === "error" ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700";
  return <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${className}`}>{label}</span>;
}

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
