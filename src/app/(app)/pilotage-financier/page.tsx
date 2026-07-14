import {
  AlertTriangle,
  Calculator,
  Check,
  CircleDollarSign,
  Info,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import {
  generateFinancialAssessmentAction,
  recordFinancialInputSnapshotAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

type FinancialPageProps = {
  searchParams: Promise<{
    donnees?: string;
    analyse?: string;
    nouvelle?: string;
  }>;
};

export default async function FinancialPage({ searchParams }: FinancialPageProps) {
  const params = await searchParams;
  const { user, tenant, membership } = await requireTenantContext();
  const services = await getServices();
  const workspace = await services.getFinancialAiWorkspace(user.id, tenant.id);
  const canManage = ["owner", "administrator", "manager"].includes(
    membership.role,
  );
  const snapshot = workspace.snapshots[0];
  const assessment = workspace.assessments[0];
  const defaultPeriod = new Date().toISOString().slice(0, 7);

  return (
    <div className="grid gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Aide à la décision
          </p>
          <h1 className="mt-1 text-4xl font-bold">Pilotage financier</h1>
        </div>
        {canManage && snapshot ? (
          <form action={generateFinancialAssessmentAction}>
            <button className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
              <RefreshCw size={18} aria-hidden />
              Actualiser l&apos;estimation
            </button>
          </form>
        ) : null}
      </header>

      <div className="flex items-start gap-3 rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
        <ShieldCheck className="mt-0.5 shrink-0" size={19} aria-hidden />
        <p>
          Ces estimations utilisent uniquement vos montants déclarés et le
          pipeline CRM. Elles ne remplacent pas la comptabilité, ne consultent
          aucun compte bancaire et ne déclenchent aucune opération.
        </p>
      </div>

      {params.donnees ? (
        <Notice text="Photographie financière enregistrée. Relancez l'estimation pour calculer les indicateurs." />
      ) : null}
      {params.analyse ? (
        <Notice
          text={params.nouvelle === "1"
            ? "Estimation calculée à partir des données disponibles."
            : "Les sources n'ont pas changé : l'estimation existante reste valable."}
        />
      ) : null}

      {canManage ? (
        <section className="border-y border-slate-200 bg-white px-5 py-6">
          <div className="flex items-start gap-3">
            <Calculator className="mt-1 text-teal-700" size={22} aria-hidden />
            <div>
              <h2 className="text-xl font-bold">Photographie mensuelle déclarée</h2>
              <p className="mt-1 text-sm text-slate-500">
                Une nouvelle saisie pour la même période crée une version et
                rend l&apos;ancienne estimation obsolète.
              </p>
            </div>
          </div>
          <form action={recordFinancialInputSnapshotAction} className="mt-6 grid gap-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MoneyField label="Période" name="period" type="month" defaultValue={snapshot?.period ?? defaultPeriod} />
              <MoneyField label="Revenu mensuel" name="monthlyRevenue" defaultValue={euros(snapshot?.monthlyRevenueCents)} />
              <MoneyField label="Charges d'exploitation" name="operatingCosts" defaultValue={euros(snapshot?.operatingCostsCents)} />
              <MoneyField label="Solde de trésorerie" name="cashBalance" defaultValue={euros(snapshot?.cashBalanceCents)} />
              <MoneyField label="Encaissements du mois" name="cashInflows" defaultValue={euros(snapshot?.cashInflowsCents)} />
              <MoneyField label="Décaissements du mois" name="cashOutflows" defaultValue={euros(snapshot?.cashOutflowsCents)} />
              <MoneyField label="Créances clients" name="receivables" defaultValue={euros(snapshot?.receivablesCents)} />
              <MoneyField label="Dettes fournisseurs" name="payables" defaultValue={euros(snapshot?.payablesCents)} />
            </div>

            <div>
              <h3 className="font-bold">Coûts et attribution</h3>
              <p className="mt-1 text-sm text-slate-500">
                Laissez le gain attribué vide si vous ne pouvez pas le justifier :
                le ROI restera indisponible.
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MoneyField label="Coût marketing" name="marketingSpend" defaultValue={euros(snapshot?.marketingSpendCents)} />
                <MoneyField label="Revenu attribué au marketing" name="marketingAttributedRevenue" required={false} defaultValue={optionalEuros(snapshot?.marketingAttributedRevenueCents)} />
                <MoneyField label="Coût commercial" name="salesSpend" defaultValue={euros(snapshot?.salesSpendCents)} />
                <MoneyField label="Revenu attribué au commercial" name="salesAttributedRevenue" required={false} defaultValue={optionalEuros(snapshot?.salesAttributedRevenueCents)} />
                <MoneyField label="Coût du site web" name="websiteSpend" defaultValue={euros(snapshot?.websiteSpendCents)} />
                <MoneyField label="Revenu attribué au site web" name="websiteAttributedRevenue" required={false} defaultValue={optionalEuros(snapshot?.websiteAttributedRevenueCents)} />
                <MoneyField label="Coût des automatisations" name="automationSpend" defaultValue={euros(snapshot?.automationSpendCents)} />
                <MoneyField label="Économies attribuées aux automatisations" name="automationSavings" required={false} defaultValue={optionalEuros(snapshot?.automationSavingsCents)} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField label="Nouveaux clients" name="newCustomers" defaultValue={snapshot?.newCustomers ?? 0} />
              <NumberField label="Clients actifs" name="activeCustomers" defaultValue={snapshot?.activeCustomers ?? 0} />
              <NumberField label="Durée client moyenne en mois" name="averageLifetimeMonths" required={false} defaultValue={snapshot?.averageLifetimeMonths ?? undefined} />
            </div>

            <label className="text-sm font-semibold text-slate-800">
              Source ou justificatif interne
              <textarea
                name="evidenceSummary"
                required
                minLength={10}
                maxLength={500}
                rows={2}
                defaultValue={snapshot?.evidenceSummary ?? "Relevé mensuel validé par la direction."}
                className={inputClassName}
              />
            </label>
            <div>
              <button className="inline-flex min-h-11 items-center gap-2 rounded-md bg-teal-700 px-5 py-3 font-semibold text-white">
                <CircleDollarSign size={18} aria-hidden />
                Enregistrer les données déclarées
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {!assessment ? (
        <section className="border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
          <TrendingUp className="mx-auto text-slate-400" size={28} aria-hidden />
          <h2 className="mt-3 text-xl font-bold">Aucune estimation disponible</h2>
          <p className="mt-1 text-sm text-slate-500">
            Enregistrez une photographie mensuelle puis lancez l&apos;estimation.
          </p>
        </section>
      ) : (
        <>
          <section aria-label="Indicateurs financiers estimés">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold">Estimation {assessment.period}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Confiance {assessment.confidence}% · version {assessment.version}
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Revenu déclaré" value={formatCurrency(assessment.monthlyRevenueCents)} />
              <Metric label="Résultat estimé" value={formatCurrency(assessment.estimatedProfitCents)} />
              <Metric label="Marge estimée" value={formatPercent(assessment.marginBasisPoints)} />
              <Metric label="Flux de trésorerie" value={formatCurrency(assessment.cashFlowCents)} />
              <Metric label="Autonomie indicative" value={assessment.cashRunwayMonths === null ? "Non applicable" : `${assessment.cashRunwayMonths} mois`} />
              <Metric label="Valeur vie client" value={formatOptionalCurrency(assessment.customerLifetimeValueCents)} />
              <Metric label="Coût d'acquisition" value={formatOptionalCurrency(assessment.customerAcquisitionCostCents)} />
              <Metric label="Pipeline enregistré" value={formatCurrency(assessment.pipelineValueCents)} />
              <Metric label="Pipeline pondéré" value={formatCurrency(assessment.weightedPipelineValueCents)} />
              <Metric label="Projection indicative à 3 mois" value={formatCurrency(assessment.forecastThreeMonthsCents)} />
              <Metric label="ROI marketing" value={formatPercent(assessment.marketingRoiBasisPoints)} />
              <Metric label="ROI commercial" value={formatPercent(assessment.salesRoiBasisPoints)} />
              <Metric label="ROI site web" value={formatPercent(assessment.websiteRoiBasisPoints)} />
              <Metric label="ROI automatisation" value={formatPercent(assessment.automationRoiBasisPoints)} />
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="bg-white p-5">
              <h2 className="text-xl font-bold">Lecture et limites</h2>
              <Detail label="Méthode" value={assessment.rationale} />
              <Detail label="Limites" value={assessment.limitations} />
              <Detail label="Action recommandée" value={assessment.recommendedAction} />
            </div>
            <div className="bg-white p-5">
              <h2 className="text-xl font-bold">Alertes explicables</h2>
              {assessment.alerts.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">
                  Aucune alerte détectée sur les données déclarées.
                </p>
              ) : (
                <ul className="mt-4 grid gap-3">
                  {assessment.alerts.map((alert) => (
                    <li key={alert.id} className="flex items-start gap-3 border-b border-slate-100 pb-3 last:border-0">
                      {alert.severity === "info" ? (
                        <Info className="mt-0.5 shrink-0 text-sky-700" size={18} aria-hidden />
                      ) : (
                        <AlertTriangle className={`mt-0.5 shrink-0 ${alert.severity === "critical" ? "text-rose-700" : "text-amber-700"}`} size={18} aria-hidden />
                      )}
                      <div>
                        <p className="font-semibold">{alert.title}</p>
                        <p className="mt-1 text-sm text-slate-600">{alert.explanation}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold">Preuves et formules utilisées</h2>
            <div className="mt-3 overflow-hidden border border-slate-200 bg-white">
              <ul className="divide-y divide-slate-100">
                {assessment.evidence.map((evidence) => (
                  <li key={evidence.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-5">
                    <span className="font-semibold text-slate-800">{evidence.label}</span>
                    <span className="text-slate-600">{evidence.observedValue}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

const inputClassName =
  "mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950";

function MoneyField({
  label,
  name,
  defaultValue,
  required = true,
  type = "number",
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  type?: "number" | "month";
}) {
  return (
    <label className="text-sm font-semibold text-slate-800">
      {label}{type === "number" ? " (€)" : ""}
      <input
        name={name}
        type={type}
        required={required}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "0.01" : undefined}
        defaultValue={defaultValue}
        className={inputClassName}
      />
    </label>
  );
}

function NumberField({
  label,
  name,
  defaultValue,
  required = true,
}: {
  label: string;
  name: string;
  defaultValue?: number;
  required?: boolean;
}) {
  return (
    <label className="text-sm font-semibold text-slate-800">
      {label}
      <input
        name={name}
        type="number"
        required={required}
        min={0}
        step={1}
        defaultValue={defaultValue}
        className={inputClassName}
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-24 bg-white px-4 py-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-bold">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-4 text-sm">
      <p className="font-semibold">{label}</p>
      <p className="mt-1 text-slate-600">{value}</p>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">
      <Check size={18} aria-hidden />
      {text}
    </div>
  );
}

function euros(value?: number) {
  return ((value ?? 0) / 100).toFixed(2);
}

function optionalEuros(value?: number | null) {
  return value === null || value === undefined ? undefined : euros(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(value / 100);
}

function formatOptionalCurrency(value: number | null) {
  return value === null ? "Données insuffisantes" : formatCurrency(value);
}

function formatPercent(value: number | null) {
  return value === null
    ? "Données insuffisantes"
    : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value / 100)} %`;
}
