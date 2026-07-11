import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const crm = await services.getCrm(user.id, tenant.id);

  return (
    <div className="grid gap-6">
      <header>
        <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
          Mon activite
        </p>
        <h1 className="mt-1 text-4xl font-bold">Journal commercial</h1>
      </header>
      <section className="rounded-lg bg-white p-5 shadow-sm">
        <div className="grid gap-3">
          {crm.activities.map((activity) => (
            <div key={activity.id} className="rounded-md border border-slate-200 px-4 py-3">
              <p className="font-semibold">{activity.summary}</p>
              <p className="text-sm text-slate-500">
                {activity.type} - {new Date(activity.createdAt).toLocaleString("fr-FR")}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
