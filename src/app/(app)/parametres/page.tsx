import {
  createInvitationAction,
  updateMemberRoleAction,
} from "@/app/actions";
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
  searchParams: Promise<{ invitation?: string; inviteEmail?: string }>;
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
  const [logs, members, pendingInvitations] = await Promise.all([
    services.getAuditLogs(user.id, tenant.id),
    services.getTenantMembers(user.id, tenant.id),
    canManageTeam
      ? services.getPendingInvitations(user.id, tenant.id)
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
        {params.invitation ? (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-900">
              Invitation prête pour {params.inviteEmail}
            </p>
            <input
              readOnly
              value={params.invitation}
              className="mt-2 w-full rounded-md border border-emerald-200 bg-white px-4 py-3 text-sm"
            />
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
                  <span>{invitation.email}</span>
                  <span className="font-semibold">{roleLabel(invitation.role)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
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
