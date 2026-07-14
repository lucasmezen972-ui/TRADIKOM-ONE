import {
  Bot,
  BrainCircuit,
  Check,
  Clock3,
  PauseCircle,
  Save,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import {
  initializeAiEmployeeTeamAction,
  reviseAiEmployeeProfileAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import type { AiEmployeeRole } from "@/modules/ai-employees";

export const dynamic = "force-dynamic";

type AiEmployeePageProps = {
  searchParams: Promise<{
    initialisee?: string;
    nouveaux?: string;
    profil?: string;
  }>;
};

export default async function AiEmployeePage({ searchParams }: AiEmployeePageProps) {
  const params = await searchParams;
  const { user, tenant, membership } = await requireTenantContext();
  const services = await getServices();
  const workspace = await services.getAiEmployeeWorkspace(user.id, tenant.id);
  const canManage = ["owner", "administrator", "manager"].includes(
    membership.role,
  );
  const enabledCount = workspace.employees.filter(
    (employee) => employee.status === "enabled",
  ).length;
  const employeeNames = new Map(
    workspace.employees.map((employee) => [employee.employeeKey, employee.displayName]),
  );

  return (
    <div className="grid gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Collègues virtuels bornés
          </p>
          <h1 className="mt-1 text-4xl font-bold">Équipe IA</h1>
        </div>
        {canManage && workspace.employees.length === 0 ? (
          <form action={initializeAiEmployeeTeamAction}>
            <button className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
              <Sparkles size={18} aria-hidden />
              Préparer l&apos;équipe virtuelle
            </button>
          </form>
        ) : null}
      </header>

      <div className="flex items-start gap-3 rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
        <ShieldCheck className="mt-0.5 shrink-0" size={19} aria-hidden />
        <p>
          Ces profils lisent des données internes autorisées et préparent des
          brouillons ou recommandations. Ils ne peuvent ni envoyer, publier,
          payer, activer un connecteur, ni écrire en production.
        </p>
      </div>

      {params.initialisee ? (
        <Notice
          text={`Équipe préparée : ${Number(params.nouveaux ?? 0)} nouveau(x) profil(s).`}
        />
      ) : null}
      {params.profil ? <Notice text="Nouvelle version du profil enregistrée." /> : null}

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Synthèse de l'équipe IA">
        <Summary label="Collègues virtuels" value={workspace.employees.length} />
        <Summary label="Profils disponibles" value={enabledCount} />
        <Summary label="Actions externes autorisées" value={0} />
      </section>

      {workspace.employees.length === 0 ? (
        <section className="border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
          <Bot className="mx-auto text-slate-400" size={30} aria-hidden />
          <h2 className="mt-3 text-xl font-bold">Aucun collègue virtuel configuré</h2>
          <p className="mt-1 text-sm text-slate-500">
            Un responsable peut préparer les profils par défaut sans activer
            aucune exécution autonome.
          </p>
        </section>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2" aria-label="Profils de l'équipe IA">
          {workspace.employees.map((employee) => (
            <article key={employee.id} className="bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <StatusBadge status={employee.status} />
                  <h2 className="mt-2 text-xl font-bold">{employee.displayName}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {roleLabels[employee.role]} · version {employee.version}
                  </p>
                </div>
                <Bot className="text-teal-700" size={24} aria-hidden />
              </div>
              <p className="mt-4 text-sm text-slate-700">{employee.purpose}</p>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <ProfileSection icon={BrainCircuit} title="Compétences">
                  {employee.skills.map((skill) => (
                    <li key={skill.key}>{skill.label} · niveau {skill.level}/5</li>
                  ))}
                </ProfileSection>
                <ProfileSection icon={Clock3} title="Horaires">
                  <li>{formatDays(employee.workingHours.workingDays)}</li>
                  <li>{employee.workingHours.start}–{employee.workingHours.end}</li>
                  <li>{employee.workingHours.timeZone}</li>
                </ProfileSection>
                <ProfileSection icon={BrainCircuit} title="Mémoire autorisée">
                  <li>{employee.memoryDomains.map((domain) => memoryDomainLabels[domain] ?? domain).join(", ")}</li>
                  <li>{employee.memory.length} fait(s) actif(s) accessible(s)</li>
                </ProfileSection>
                <ProfileSection icon={Wrench} title="Outils internes">
                  {employee.tools.map((tool) => (
                    <li key={tool.key}>{tool.label} · {tool.mode === "read_only" ? "lecture seule" : "brouillon"}</li>
                  ))}
                </ProfileSection>
              </div>

              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Permissions et limites
                </p>
                <ul className="mt-2 grid gap-1 text-sm text-slate-700">
                  {employee.permissions.map((permission) => (
                    <li key={permission.capability}>
                      {permissionLabels[permission.capability] ?? "Fonction interne bornée"} · {permission.access === "read" ? "lecture" : "proposition"}
                      {permission.approvalRequired ? " · approbation requise" : ""}
                    </li>
                  ))}
                  <li>Communications externes : interdites</li>
                  <li>Écritures de production : interdites</li>
                  <li>Transactions financières : interdites</li>
                  <li>Activation de connecteur : interdite</li>
                </ul>
              </div>

              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">KPI</p>
                <ul className="mt-2 grid gap-2 text-sm">
                  {employee.kpis.map((kpi) => (
                    <li key={kpi.key}>
                      <span className="font-semibold">{kpi.label}</span>
                      <span className="block text-slate-600">{kpi.target}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {canManage ? (
                <details className="mt-5 border-t border-slate-100 pt-4">
                  <summary className="cursor-pointer text-sm font-semibold text-teal-800">
                    Configurer ce profil
                  </summary>
                  <form action={reviseAiEmployeeProfileAction} className="mt-4 grid gap-4">
                    <input type="hidden" name="employeeId" value={employee.id} />
                    <label className="text-sm font-semibold">
                      Nom affiché
                      <input name="displayName" defaultValue={employee.displayName} required minLength={3} maxLength={100} className={inputClassName} />
                    </label>
                    <label className="text-sm font-semibold">
                      Mission
                      <textarea name="purpose" defaultValue={employee.purpose} required minLength={10} maxLength={500} rows={2} className={inputClassName} />
                    </label>
                    <label className="text-sm font-semibold">
                      État
                      <select name="status" defaultValue={employee.status} className={inputClassName}>
                        <option value="enabled">Disponible pour préparer</option>
                        <option value="paused">En pause</option>
                      </select>
                    </label>
                    <fieldset>
                      <legend className="text-sm font-semibold">Jours de travail</legend>
                      <div className="mt-2 flex flex-wrap gap-3">
                        {dayOptions.map((day) => (
                          <label key={day.value} className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              name="workingDays"
                              value={day.value}
                              defaultChecked={employee.workingHours.workingDays.includes(day.value)}
                            />
                            {day.label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-sm font-semibold">
                        Début
                        <input type="time" name="workdayStart" defaultValue={employee.workingHours.start} required className={inputClassName} />
                      </label>
                      <label className="text-sm font-semibold">
                        Fin
                        <input type="time" name="workdayEnd" defaultValue={employee.workingHours.end} required className={inputClassName} />
                      </label>
                    </div>
                    <div>
                      <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white">
                        <Save size={16} aria-hidden />
                        Enregistrer une nouvelle version
                      </button>
                    </div>
                  </form>
                </details>
              ) : null}
            </article>
          ))}
        </section>
      )}

      <section>
        <h2 className="text-xl font-bold">Journal d&apos;activité immuable</h2>
        {workspace.activities.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Aucune activité enregistrée.</p>
        ) : (
          <div className="mt-3 overflow-hidden border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-100">
              {workspace.activities.slice(0, 30).map((activity) => (
                <li key={activity.id} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                  <div>
                    <p className="font-semibold">{activity.summary}</p>
                    <p className="mt-1 text-slate-500">
                      {employeeNames.get(activity.employeeKey) ?? "Collègue virtuel"} · {activityTypeLabels[activity.type] ?? "Mise à jour interne"}
                    </p>
                  </div>
                  <time className="shrink-0 text-xs text-slate-500">
                    {new Date(activity.createdAt).toLocaleString("fr-FR")}
                  </time>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

const inputClassName =
  "mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950";

const roleLabels: Record<AiEmployeeRole, string> = {
  marketing_manager: "Responsable marketing",
  sales_assistant: "Assistant commercial",
  receptionist: "Réception",
  customer_support: "Support client",
  seo_specialist: "Expert SEO",
  content_writer: "Rédaction",
  business_analyst: "Analyse d'entreprise",
  automation_engineer: "Automatisation",
  website_manager: "Gestion du site",
};

const dayOptions = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Jeu" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sam" },
  { value: 7, label: "Dim" },
];

const memoryDomainLabels: Record<string, string> = {
  company: "entreprise",
  customers: "clients",
  suppliers: "fournisseurs",
  catalog: "offres",
  pricing: "prix",
  margins: "marges",
  objectives: "objectifs",
  kpis: "indicateurs",
  team: "équipe",
  locations: "implantations",
  automations: "automatisations",
  websites: "sites web",
  api: "API",
  connectors: "connecteurs",
};

const permissionLabels: Record<string, string> = {
  "business_brain.read": "Mémoire d'entreprise",
  "internal_recommendation.propose": "Recommandations internes",
  "marketing.proposals.read": "Brouillons marketing",
  "crm.read": "Données commerciales",
  "crm.inbound.read": "Demandes entrantes",
  "crm.activities.read": "Historique client",
  "website.draft.read": "Brouillon du site",
  "website.content.read": "Contenus approuvés",
  "dashboard.financial.read": "Indicateurs de pilotage",
  "workflow.health.read": "Santé des automatisations",
  "website.versions.read": "Versions du site",
};

const activityTypeLabels: Record<string, string> = {
  provisioned: "profil fourni",
  initialized: "profil initialisé",
  profile_revised: "configuration révisée",
  paused: "mise en pause",
  resumed: "réactivation",
};

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white px-4 py-3 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function ProfileSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof BrainCircuit;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Icon size={16} className="text-teal-700" aria-hidden />
        {title}
      </p>
      <ul className="mt-2 grid gap-1 text-sm text-slate-600">{children}</ul>
    </div>
  );
}

function StatusBadge({ status }: { status: "enabled" | "paused" }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${status === "enabled" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
      {status === "enabled" ? <Check size={13} aria-hidden /> : <PauseCircle size={13} aria-hidden />}
      {status === "enabled" ? "Disponible pour préparer" : "En pause"}
    </span>
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

function formatDays(days: number[]) {
  return days.map((day) => dayOptions.find((item) => item.value === day)?.label).filter(Boolean).join(", ");
}
