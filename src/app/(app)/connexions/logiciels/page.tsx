import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Link2,
  Power,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  disconnectSoftwareConnectionAction,
  enableMockConnectorReadOnlyAction,
  executeMockConnectorReadOnlyAction,
  prepareMockConnectorInstallationAction,
  refreshMockOAuthCredentialAction,
  startMockOAuthConnectionAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

type SoftwareConnectionsPageProps = {
  searchParams: Promise<{ oauth?: string }>;
};

const statusLabels: Record<string, string> = {
  oauth_pending: "Autorisation en attente",
  connected: "Connecté",
  authentication_expired: "Authentification expirée",
  unhealthy: "Connexion dégradée",
  disconnected: "Déconnecté",
  revoked: "Accès révoqué",
};

const scopeLabels: Record<string, string> = {
  "contacts.read": "Lecture des contacts",
  "profile.read": "Lecture du profil",
};

const installationStatusLabels: Record<string, string> = {
  installed_disabled: "Installé, désactivé",
  read_only_enabled: "Lecture seule active",
  suspended: "Suspendu",
  authentication_expired: "Authentification expirée",
  unhealthy: "Dégradé",
  disconnected: "Déconnecté",
  revoked: "Révoqué",
};

const healthStateLabels: Record<string, string> = {
  healthy: "Sain",
  degraded: "Dégradé",
  action_required: "Action requise",
  authentication_required: "Authentification requise",
  rate_limited: "Quota atteint",
  schema_changed: "Schéma modifié",
  suspended: "Suspendu",
  disconnected: "Déconnecté",
  unknown: "Non vérifié",
};

export default async function SoftwareConnectionsPage({
  searchParams,
}: SoftwareConnectionsPageProps) {
  const params = await searchParams;
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const [workspace, executionWorkspace] = await Promise.all([
    services
      .getSoftwareConnectionWorkspace(user.id, tenant.id)
      .catch(() => null),
    services
      .getConnectorExecutionWorkspace(user.id, tenant.id)
      .catch(() => null),
  ]);

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
            Centre de connexion
          </p>
          <h1 className="mt-1 text-3xl font-bold">Connexions logicielles</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Contrôlez l’environnement, les accès accordés et la révocation de
            chaque logiciel connecté.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-md bg-[#e6fffb] px-3 py-2 text-xs font-semibold text-[#075e57]">
          <ShieldCheck size={16} aria-hidden />
          Secrets côté serveur
        </span>
      </header>

      {params.oauth === "connecte" ? (
        <Notice kind="success">
          La connexion OAuth a été autorisée. Aucun jeton n’a été exposé au
          navigateur.
        </Notice>
      ) : null}
      {params.oauth === "refuse" ? (
        <Notice kind="neutral">
          L’autorisation a été refusée et la demande en attente a été invalidée.
        </Notice>
      ) : null}
      {params.oauth === "erreur" ? (
        <Notice kind="error">
          La connexion n’a pas pu être terminée. Aucun accès logiciel utilisable
          n’a été créé.
        </Notice>
      ) : null}

      {workspace === null ? (
        <Notice kind="error">
          Les connexions logicielles sont temporairement indisponibles. Aucun
          accès externe n’a été modifié.
        </Notice>
      ) : (
        <>
          <section className="grid gap-4">
            <div className="flex items-center gap-3">
              <Link2 size={21} aria-hidden />
              <h2 className="text-xl font-bold">Logiciels disponibles</h2>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {workspace.available.map((software) => (
                <article
                  key={software.key}
                  className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold">{software.name}</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        {software.vendor} · {software.officialSource}
                      </p>
                    </div>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                      Mock local
                    </span>
                  </div>

                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="font-semibold">Authentification</dt>
                      <dd className="mt-1 text-slate-600">
                        {software.authenticationMethod}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Confiance</dt>
                      <dd className="mt-1 text-slate-600">
                        {software.confidence} % · fixture contrôlée
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {software.readCapabilities.map((capability) => (
                      <span
                        key={capability}
                        className="rounded-md bg-[#e6fffb] px-2 py-1 text-xs font-semibold text-[#075e57]"
                      >
                        {capability}
                      </span>
                    ))}
                  </div>
                  <p className="mt-4 text-sm text-slate-600">
                    {software.limitations.join(" · ")}
                  </p>

                  {workspace.canManage ? (
                    <form
                      action={startMockOAuthConnectionAction}
                      className="mt-5 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <label className="grid gap-1 text-sm font-semibold" htmlFor={`account-${software.key}`}>
                        Libellé du compte
                        <input
                          id={`account-${software.key}`}
                          name="accountLabel"
                          required
                          defaultValue="Compte atelier de test"
                          className="min-h-10 rounded-md border border-slate-300 bg-white px-3 font-normal"
                        />
                      </label>
                      <button className="inline-flex min-h-10 self-end items-center justify-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                        <KeyRound size={16} aria-hidden />
                        Connecter avec OAuth
                      </button>
                    </form>
                  ) : (
                    <p className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600">
                      Seuls le propriétaire et les administrateurs peuvent
                      connecter un logiciel.
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-4">
            <div className="flex items-center gap-3">
              <ShieldCheck size={21} aria-hidden />
              <h2 className="text-xl font-bold">Connexions de l’organisation</h2>
            </div>
            {workspace.connections.length === 0 ? (
              <div className="border-y border-slate-200 py-8 text-sm text-slate-600">
                Aucun logiciel connecté pour cette organisation.
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {workspace.connections.map((connection) => {
                  const installation = executionWorkspace?.installations.find(
                    (item) => item.connectionId === connection.id,
                  );
                  return (
                    <article
                      key={connection.id}
                      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                    >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold">
                          {connection.softwareName}
                        </h3>
                        <p className="mt-1 text-sm text-slate-600">
                          {connection.accountLabel}
                        </p>
                      </div>
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                        {statusLabels[connection.status] ?? connection.status}
                      </span>
                    </div>

                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="font-semibold">Environnement</dt>
                        <dd className="mt-1 text-slate-600">Mock local</dd>
                      </div>
                      <div>
                        <dt className="font-semibold">Expiration</dt>
                        <dd className="mt-1 text-slate-600">
                          {connection.credentialExpiresAt
                            ? new Date(
                                connection.credentialExpiresAt,
                              ).toLocaleString("fr-FR")
                            : "Aucun credential actif"}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {connection.scopes.length === 0 ? (
                        <span className="text-sm text-slate-500">
                          Aucun accès actif
                        </span>
                      ) : (
                        connection.scopes.map((scope) => (
                          <span
                            key={scope}
                            className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
                          >
                            {scopeLabels[scope] ?? scope}
                          </span>
                        ))
                      )}
                    </div>

                    {installation ? (
                      <div className="mt-4 border-t border-slate-100 pt-4 text-sm">
                        <p className="font-semibold text-slate-900">
                          Connecteur{" "}
                          {installationStatusLabels[installation.status] ??
                            installation.status}
                        </p>
                        <p className="mt-1 text-slate-600">
                          Santé :{" "}
                          {
                            healthStateLabels[
                              installation.health?.state ?? "unknown"
                            ]
                          }
                          {installation.latestExecution?.safeResultSummary
                            ? ` · ${installation.latestExecution.safeResultSummary}`
                            : ""}
                        </p>
                      </div>
                    ) : null}

                    {workspace.canManage && connection.status === "connected" ? (
                      <div className="mt-5 flex flex-wrap gap-3 border-t border-slate-100 pt-4">
                        {!installation ? (
                          <form action={prepareMockConnectorInstallationAction}>
                            <input
                              type="hidden"
                              name="connectionId"
                              value={connection.id}
                            />
                            <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                              <Link2 size={16} aria-hidden />
                              Installer en mode désactivé
                            </button>
                          </form>
                        ) : installation.status === "installed_disabled" ? (
                          <form action={enableMockConnectorReadOnlyAction}>
                            <input
                              type="hidden"
                              name="installationId"
                              value={installation.id}
                            />
                            <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                              <ShieldCheck size={16} aria-hidden />
                              Activer la lecture seule
                            </button>
                          </form>
                        ) : installation.status === "read_only_enabled" ? (
                          <form action={executeMockConnectorReadOnlyAction}>
                            <input
                              type="hidden"
                              name="installationId"
                              value={installation.id}
                            />
                            <button className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                              <RefreshCw size={16} aria-hidden />
                              Synchroniser en lecture seule
                            </button>
                          </form>
                        ) : null}
                        <form action={refreshMockOAuthCredentialAction}>
                          <input
                            type="hidden"
                            name="connectionId"
                            value={connection.id}
                          />
                          <button className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                            <RefreshCw size={16} aria-hidden />
                            Rafraîchir l’accès
                          </button>
                        </form>
                        <form action={disconnectSoftwareConnectionAction}>
                          <input
                            type="hidden"
                            name="connectionId"
                            value={connection.id}
                          />
                          <button className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">
                            <Power size={16} aria-hidden />
                            Déconnecter
                          </button>
                        </form>
                      </div>
                    ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="grid gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 size={21} aria-hidden />
              <h2 className="text-xl font-bold">Santé des connecteurs</h2>
            </div>
            {executionWorkspace === null ? (
              <Notice kind="error">
                La santé des connecteurs est temporairement indisponible. Aucun
                payload ni secret n’a été affiché.
              </Notice>
            ) : executionWorkspace.installations.length === 0 ? (
              <div className="border-y border-slate-200 py-8 text-sm text-slate-600">
                Aucun connecteur installé. Une connexion OAuth seule n’active
                aucune synchronisation.
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {executionWorkspace.installations.map((installation) => {
                  const connection = workspace.connections.find(
                    (item) => item.id === installation.connectionId,
                  );
                  const health = installation.health;
                  return (
                    <article
                      key={installation.id}
                      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-bold">
                            {connection?.softwareName ??
                              installation.connectorKey}
                          </h3>
                          <p className="mt-1 text-sm text-slate-600">
                            {connection?.accountLabel ?? "Compte non disponible"}
                          </p>
                        </div>
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                          {healthStateLabels[health?.state ?? "unknown"]}
                        </span>
                      </div>
                      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                        <HealthValue label="Environnement" value="Mock local" />
                        <HealthValue
                          label="Authentification"
                          value={
                            health?.authenticationState === "valid"
                              ? "Valide"
                              : "À vérifier"
                          }
                        />
                        <HealthValue
                          label="Dernière synchronisation réussie"
                          value={formatDate(health?.lastSuccessfulSyncAt)}
                        />
                        <HealthValue
                          label="Dernier échec"
                          value={formatDate(health?.lastFailedSyncAt)}
                        />
                        <HealthValue
                          label="Latence"
                          value={
                            health?.latencyMs === null ||
                            health?.latencyMs === undefined
                              ? "Non mesurée"
                              : `${health.latencyMs} ms`
                          }
                        />
                        <HealthValue
                          label="Quota restant"
                          value={
                            health?.rateLimitRemaining === null ||
                            health?.rateLimitRemaining === undefined
                              ? "Non mesuré"
                              : String(health.rateLimitRemaining)
                          }
                        />
                        <HealthValue
                          label="Réinitialisation du quota"
                          value={formatDate(health?.rateLimitResetAt)}
                        />
                        <HealthValue
                          label="Version API"
                          value={installation.apiVersion}
                        />
                        <HealthValue
                          label="Version connecteur"
                          value={installation.connectorVersion}
                        />
                        <HealthValue
                          label="Webhook"
                          value={
                            health?.webhookState === "not_configured"
                              ? "Non configuré"
                              : health?.webhookState ?? "Non mesuré"
                          }
                        />
                        <HealthValue
                          label="Dérive de schéma"
                          value={
                            health?.schemaDriftState === "stable"
                              ? "Stable"
                              : health?.schemaDriftState ?? "Non mesurée"
                          }
                        />
                        <HealthValue
                          label="Rupture API"
                          value={
                            health?.breakingChangeState === "clear"
                              ? "Aucune"
                              : health?.breakingChangeState ?? "Non mesurée"
                          }
                        />
                        <HealthValue
                          label="Relances en attente"
                          value={String(health?.retryBacklog ?? 0)}
                        />
                      </dl>
                      <p className="mt-4 border-t border-slate-100 pt-4 text-sm font-semibold text-slate-900">
                        Action recommandée :{" "}
                        {health?.recommendedAction ??
                          "Installer puis activer le connecteur"}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function HealthValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-slate-900">{label}</dt>
      <dd className="mt-1 text-slate-600">{value}</dd>
    </div>
  );
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString("fr-FR") : "Jamais";
}

function Notice({
  children,
  kind,
}: {
  children: ReactNode;
  kind: "success" | "neutral" | "error";
}) {
  const className =
    kind === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : kind === "error"
        ? "border-red-200 bg-red-50 text-red-800"
        : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <section
      className={`flex items-start gap-3 border-y px-4 py-5 text-sm ${className}`}
    >
      {kind === "success" ? (
        <CheckCircle2 size={18} aria-hidden />
      ) : kind === "error" ? (
        <TriangleAlert size={18} aria-hidden />
      ) : (
        <ShieldCheck size={18} aria-hidden />
      )}
      <p>{children}</p>
    </section>
  );
}
