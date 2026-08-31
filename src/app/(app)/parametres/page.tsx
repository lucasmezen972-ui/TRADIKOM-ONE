import {
  createInvitationAction,
  deleteAccountAction,
  releaseEmailSuppressionAction,
  resendInvitationAction,
  updateMemberRoleAction,
  updateTenantPreferencesAction,
} from "@/app/actions";
import {
  maxStalledOpportunityDays,
  minStalledOpportunityDays,
} from "@/lib/pipeline-stages";
import {
  maxStrategicMuteDays,
  minStrategicMuteDays,
} from "@/modules/strategic-advisor/rules";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

const editableRoles: Exclude<Role, "owner">[] = [
  "administrator",
  "manager",
  "collaborator",
  "read-only",
];

type SettingsPageProps = {
  searchParams: Promise<{
    invitationEnvoyee?: string;
    inviteEmail?: string;
    lien?: string;
    suppressionCompte?: string;
    messageSuppression?: string;
    preferences?: string;
    messagePreferences?: string;
    blocage?: string;
    messageBlocage?: string;
  }>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const { user, tenant, membership } = await requireTenantContext();
  const services = await getServices();
  const canManageTeam =
    membership.role === "owner" || membership.role === "administrator";
  const manageableRoles =
    membership.role === "owner"
      ? editableRoles
      : editableRoles.filter((role) => role !== "administrator");
  const [logs, members, pendingInvitations, suppressions] = await Promise.all([
    services.getAuditLogs(user.id, tenant.id),
    services.getTenantMembers(user.id, tenant.id),
    canManageTeam
      ? services.getPendingInvitations(user.id, tenant.id)
      : Promise.resolve([]),
    canManageTeam
      ? services.getEmailSuppressions(user.id, tenant.id)
      : Promise.resolve([]),
  ]);

  return (
    <div className="grid gap-6">
      <header>
        <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
          Paramètres
        </p>
        <h1 className="mt-1 text-4xl font-bold">{tenant.name}</h1>
      </header>
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Rôle</p>
          <p className="mt-2 text-xl font-bold">{roleLabel(membership.role)}</p>
        </div>
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Slug local</p>
          <p className="mt-2 text-xl font-bold">{tenant.slug}</p>
        </div>
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Catégorie</p>
          <p className="mt-2 text-xl font-bold">{tenant.category}</p>
        </div>
      </section>
      <section className="rounded-lg bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">Équipe</h2>
            <p className="mt-1 text-sm text-slate-500">
              Membres actifs et invitations en attente.
            </p>
          </div>
          {canManageTeam ? (
            <form
              action={createInvitationAction}
              className="grid w-full gap-3 rounded-md border border-slate-200 p-4 md:w-[28rem]"
            >
              <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
                <input
                  required
                  type="email"
                  name="email"
                  placeholder="email@entreprise.com"
                  className="rounded-md border border-slate-200 px-4 py-3"
                />
                <select
                  name="role"
                  defaultValue={manageableRoles[0]}
                  className="rounded-md border border-slate-200 px-4 py-3"
                >
                  {manageableRoles.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(role)}
                    </option>
                  ))}
                </select>
              </div>
              <button className="rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
                Créer l&apos;invitation
              </button>
            </form>
          ) : null}
        </div>
        {params.invitationEnvoyee ? (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-900">
              Invitation envoyée à {params.inviteEmail}
            </p>
            {params.lien ? (
              <a
                href={params.lien}
                className="mt-2 block text-sm font-semibold text-emerald-950 underline"
              >
                Ouvrir le lien de développement
              </a>
            ) : null}
          </div>
        ) : null}
        <div className="mt-5 grid gap-3">
          {members.map((member) => {
            const canEditMember =
              canManageTeam &&
              member.user.id !== user.id &&
              member.membership.role !== "owner";

            return (
              <div
                key={member.user.id}
                className="grid gap-3 rounded-md border border-slate-200 px-4 py-3 md:grid-cols-[1fr_auto]"
              >
                <div>
                  <p className="font-semibold">{member.user.name}</p>
                  <p className="text-sm text-slate-500">{member.user.email}</p>
                </div>
                {canEditMember ? (
                  <form action={updateMemberRoleAction} className="flex gap-2">
                    <input type="hidden" name="targetUserId" value={member.user.id} />
                    <select
                      name="role"
                      defaultValue={member.membership.role}
                      className="rounded-md border border-slate-200 px-3 py-2"
                    >
                      {manageableRoles.map((role) => (
                        <option key={role} value={role}>
                          {roleLabel(role)}
                        </option>
                      ))}
                    </select>
                    <button className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
                      Mettre à jour
                    </button>
                  </form>
                ) : (
                  <p className="text-sm font-semibold text-slate-600">
                    {roleLabel(member.membership.role)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {pendingInvitations.length > 0 ? (
          <div className="mt-5">
            <h3 className="font-semibold">Invitations en attente</h3>
            <div className="mt-3 grid gap-2">
              {pendingInvitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm"
                >
                  <span>
                    {invitation.email} · {roleLabel(invitation.role)}
                  </span>
                  <span className="font-semibold">
                    {deliveryLabel(invitation.deliveryStatus)}
                  </span>
                  <form action={resendInvitationAction}>
                    <input type="hidden" name="invitationId" value={invitation.id} />
                    <button className="rounded-md border border-slate-300 px-3 py-2 font-semibold text-slate-700">
                      Renvoyer
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
      {canManageTeam ? (
        <section className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Adresses bloquées</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Une adresse dont l&apos;envoi a définitivement échoué est bloquée :
            réessayer n&apos;aboutirait pas et abîmerait la réputation du
            domaine d&apos;expédition. Corrigez l&apos;adresse, puis
            réautorisez-la si elle est valide.
          </p>
          {params.blocage === "leve" ? (
            <p
              role="status"
              className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900"
            >
              Adresse réautorisée. Vous pouvez de nouveau lui envoyer une
              invitation.
            </p>
          ) : null}
          {params.blocage === "refus" ? (
            <p
              role="status"
              className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
            >
              {params.messageBlocage ?? "Cette adresse est bloquée."}
            </p>
          ) : null}
          {suppressions.length === 0 ? (
            <p className="mt-4 rounded-md border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
              Aucune adresse bloquée. Tous vos envois d&apos;invitation ont
              abouti ou n&apos;ont échoué que temporairement.
            </p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {suppressions.map((suppression) => (
                <li
                  key={suppression.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">
                      {suppression.email}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {suppression.detail}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {suppressionReasonLabel(suppression.reason)} — via{" "}
                      {suppression.provider}
                      {suppression.errorCode
                        ? ` (${suppression.errorCode})`
                        : ""}{" "}
                      le{" "}
                      {new Date(suppression.createdAt).toLocaleDateString(
                        "fr-FR",
                      )}
                    </p>
                  </div>
                  <form action={releaseEmailSuppressionAction}>
                    <input
                      type="hidden"
                      name="email"
                      value={suppression.email}
                    />
                    <button className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800">
                      Réautoriser
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Pilotage commercial</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Une opportunité ouverte est signalée comme bloquée quand elle
          n&apos;a pas avancé depuis ce nombre de jours, faute d&apos;action
          planifiée ou de relance effectuée. Le seuil s&apos;applique au
          tableau de bord et au filtre « Opportunités bloquées ».
        </p>
        {params.preferences === "ok" ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900"
          >
            Seuil enregistré. Les vues « bloquées » utilisent désormais{" "}
            {tenant.stalledOpportunityDays} jours.
          </p>
        ) : null}
        {params.preferences === "erreur" ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
          >
            {params.messagePreferences ?? "Seuil refusé."}
          </p>
        ) : null}
        {canManageTeam ? (
          <form
            action={updateTenantPreferencesAction}
            className="mt-4 flex flex-wrap items-end gap-3"
          >
            <label
              className="grid gap-1 text-sm font-semibold text-slate-700"
              htmlFor="stalledOpportunityDays"
            >
              Seuil d&apos;opportunité bloquée (jours)
              <input
                id="stalledOpportunityDays"
                name="stalledOpportunityDays"
                type="number"
                inputMode="numeric"
                min={minStalledOpportunityDays}
                max={maxStalledOpportunityDays}
                step={1}
                required
                defaultValue={tenant.stalledOpportunityDays}
                className="w-40 rounded-md border border-slate-200 px-4 py-3 font-normal"
              />
            </label>
            <label
              className="grid gap-1 text-sm font-semibold text-slate-700"
              htmlFor="strategicMuteDays"
            >
              Sourdine d&apos;une règle refusée (jours)
              <input
                id="strategicMuteDays"
                name="strategicMuteDays"
                type="number"
                inputMode="numeric"
                min={minStrategicMuteDays}
                max={maxStrategicMuteDays}
                step={1}
                required
                defaultValue={tenant.strategicMuteDays}
                className="w-40 rounded-md border border-slate-200 px-4 py-3 font-normal"
              />
            </label>
            <button className="rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
              Enregistrer
            </button>
            <p className="w-full text-sm text-slate-500">
              Seuil bloqué : entre {minStalledOpportunityDays} et{" "}
              {maxStalledOpportunityDays} jours. Sourdine : entre{" "}
              {minStrategicMuteDays} et {maxStrategicMuteDays} jours — durée
              pendant laquelle un conseil refusé n&apos;est plus proposé
              (`docs/STRATEGIC_ADVISOR.md`).
            </p>
          </form>
        ) : (
          <p className="mt-4 rounded-md border border-slate-200 px-4 py-3 text-sm text-slate-600">
            Seuil d&apos;opportunité bloquée : {tenant.stalledOpportunityDays}{" "}
            jours. Sourdine d&apos;une règle refusée :{" "}
            {tenant.strategicMuteDays} jours. Seuls le propriétaire et les
            administrateurs peuvent les modifier.
          </p>
        )}
      </section>
      <section className="rounded-lg border border-red-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-red-700">Supprimer mon compte</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Cette action est définitive : vos sessions seront révoquées, vos
          accès aux organisations retirés et vos données personnelles (nom,
          email, mot de passe) anonymisées, conformément au RGPD. Si vous êtes
          le seul propriétaire d&apos;une organisation, transférez d&apos;abord
          la propriété ou supprimez cette organisation.
        </p>
        {params.suppressionCompte === "erreur" ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
            {params.messageSuppression ??
              "La suppression du compte a été refusée."}
          </p>
        ) : null}
        <form
          action={deleteAccountAction}
          className="mt-4 grid max-w-xl gap-3 rounded-md border border-red-100 p-4"
        >
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Mot de passe actuel
            <input
              required
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="Votre mot de passe"
              className="rounded-md border border-slate-200 px-4 py-3 font-normal"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Confirmation
            <input
              required
              type="text"
              name="confirmation"
              placeholder="Saisissez SUPPRIMER"
              className="rounded-md border border-slate-200 px-4 py-3 font-normal"
            />
            <span className="text-xs font-normal text-slate-500">
              Saisissez « SUPPRIMER » en majuscules pour confirmer.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input required type="checkbox" name="consentement" className="mt-1" />
            Je comprends que la suppression de mon compte est définitive et
            irréversible.
          </label>
          <button className="rounded-md bg-red-700 px-5 py-3 font-semibold text-white">
            Supprimer définitivement mon compte
          </button>
        </form>
      </section>
      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Audit log</h2>
        <div className="mt-4 grid gap-3">
          {logs.map((log) => (
            <div key={log.id} className="rounded-md border border-slate-200 px-4 py-3">
              <p className="font-semibold">{log.action}</p>
              <p className="text-sm text-slate-500">
                {log.targetType} - {new Date(log.createdAt).toLocaleString("fr-FR")}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function suppressionReasonLabel(reason: string) {
  return reason === "permanent_failure"
    ? "Échec définitif de livraison"
    : "Blocage manuel";
}

function roleLabel(role: Role) {
  switch (role) {
    case "owner":
      return "Propriétaire";
    case "administrator":
      return "Administrateur";
    case "manager":
      return "Manager";
    case "collaborator":
      return "Collaborateur";
    case "read-only":
      return "Lecture seule";
  }
}

function deliveryLabel(status: string) {
  switch (status) {
    case "sent":
      return "Envoyée";
    case "retryable_failure":
      return "Envoi à relancer";
    case "permanent_failure":
      return "Échec de l'envoi";
    default:
      return "En attente";
  }
}
