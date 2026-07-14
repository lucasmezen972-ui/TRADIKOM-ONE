import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  HeartPulse,
  ShieldCheck,
} from "lucide-react";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

const statusContent = {
  healthy: {
    label: "Sain",
    className: "border-teal-200 bg-teal-50 text-teal-950",
    icon: CheckCircle2,
  },
  attention: {
    label: "À surveiller",
    className: "border-amber-200 bg-amber-50 text-amber-950",
    icon: AlertTriangle,
  },
  critical: {
    label: "Action requise",
    className: "border-red-200 bg-red-50 text-red-950",
    icon: AlertTriangle,
  },
  unavailable: {
    label: "Non instrumenté",
    className: "border-slate-200 bg-slate-50 text-slate-700",
    icon: CircleHelp,
  },
} as const;

export default async function EnterpriseObservabilityPage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const observability = await services.getEnterpriseObservability(
    user.id,
    tenant.id,
  );

  return (
    <div className="grid gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Supervision d&apos;entreprise
          </p>
          <h1 className="mt-1 text-4xl font-bold">Santé opérationnelle</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            État des signaux réellement disponibles pour cette organisation, sans
            redémarrage automatique ni statut supposé.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <HeartPulse size={18} className="text-teal-700" aria-hidden />
          {observability.overview.measured} signaux mesurés
        </div>
      </header>

      <div className="flex items-start gap-3 rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
        <ShieldCheck className="mt-0.5 shrink-0" size={19} aria-hidden />
        <p>
          Cette vue n&apos;exécute aucune correction. Les cartes non instrumentées restent
          explicitement inconnues jusqu&apos;à la disponibilité d&apos;une mesure fiable.
        </p>
      </div>

      <section aria-label="Résumé de santé" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Summary label="Sains" value={observability.overview.healthy} tone="teal" />
        <Summary label="À surveiller" value={observability.overview.attention} tone="amber" />
        <Summary label="Actions requises" value={observability.overview.critical} tone="red" />
        <Summary label="Non instrumentés" value={observability.overview.unavailable} tone="slate" />
      </section>

      <section aria-label="Signaux opérationnels" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {observability.metrics.map((metric) => {
          const status = statusContent[metric.status];
          const StatusIcon = status.icon;
          return (
            <article key={metric.key} className="flex min-h-64 flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-bold">{metric.title}</h2>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold ${status.className}`}>
                  <StatusIcon size={14} aria-hidden />
                  {status.label}
                </span>
              </div>
              <p className="mt-3 text-sm text-slate-600">{metric.summary}</p>
              <dl className="mt-4 grid gap-2 border-t border-slate-100 pt-4">
                {metric.details.map((detail) => (
                  <div key={detail.label} className="flex items-center justify-between gap-3 text-sm">
                    <dt className="text-slate-500">{detail.label}</dt>
                    <dd className="text-right font-semibold text-slate-900">{detail.value}</dd>
                  </div>
                ))}
              </dl>
              {metric.action ? (
                <Link
                  href={metric.action.href}
                  className="mt-auto w-fit pt-5 text-sm font-semibold text-teal-800 underline decoration-teal-300 underline-offset-4"
                >
                  {metric.action.label}
                </Link>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "teal" | "amber" | "red" | "slate";
}) {
  const styles = {
    teal: "border-teal-200 text-teal-900",
    amber: "border-amber-200 text-amber-900",
    red: "border-red-200 text-red-900",
    slate: "border-slate-200 text-slate-700",
  } as const;
  return (
    <div className={`border bg-white px-4 py-3 ${styles[tone]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm">{label}</p>
    </div>
  );
}
