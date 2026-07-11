import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user, tenant, membership } = await requireTenantContext();
  const services = await getServices();
  const logs = await services.getAuditLogs(user.id, tenant.id);

  return (
    <div className="grid gap-6">
      <header>
        <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
          Parametres
        </p>
        <h1 className="mt-1 text-4xl font-bold">{tenant.name}</h1>
      </header>
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Role</p>
          <p className="mt-2 text-xl font-bold">{membership.role}</p>
        </div>
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Slug local</p>
          <p className="mt-2 text-xl font-bold">{tenant.slug}</p>
        </div>
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Categorie</p>
          <p className="mt-2 text-xl font-bold">{tenant.category}</p>
        </div>
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
