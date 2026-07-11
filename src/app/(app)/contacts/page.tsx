import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const crm = await services.getCrm(user.id, tenant.id);

  return (
    <div className="grid gap-6">
      <header>
        <p className="text-sm uppercase tracking-[0.16em] text-slate-500">CRM</p>
        <h1 className="mt-1 text-4xl font-bold">Contacts et leads</h1>
      </header>

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Contacts</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="py-3">Nom</th>
                <th>Email</th>
                <th>Telephone</th>
                <th>Source</th>
                <th>Statut</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {crm.contacts.map((contact) => (
                <tr key={contact.id} className="border-t border-slate-100">
                  <td className="py-3 font-semibold">{contact.name}</td>
                  <td>{contact.email}</td>
                  <td>{contact.phone}</td>
                  <td>{contact.source}</td>
                  <td>{contact.status}</td>
                  <td>{contact.tags.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Leads</h2>
          <div className="mt-4 grid gap-3">
            {crm.leads.map((lead) => (
              <div key={lead.id} className="rounded-md border border-slate-200 px-4 py-3">
                <p className="font-semibold">{lead.status}</p>
                <p className="text-sm text-slate-500">
                  {lead.source} - {lead.pagePath}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Taches de suivi</h2>
          <div className="mt-4 grid gap-3">
            {crm.tasks.map((task) => (
              <div key={task.id} className="rounded-md border border-slate-200 px-4 py-3">
                <p className="font-semibold">{task.title}</p>
                <p className="text-sm text-slate-500">
                  Echeance : {new Date(task.dueAt).toLocaleDateString("fr-FR")}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Timeline</h2>
        <div className="mt-4 grid gap-3">
          {crm.activities.map((activity) => (
            <div key={activity.id} className="rounded-md border border-slate-200 px-4 py-3">
              <p className="font-semibold">{activity.summary}</p>
              <p className="text-sm text-slate-500">{activity.type}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
