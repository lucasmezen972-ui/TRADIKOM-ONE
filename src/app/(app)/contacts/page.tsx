import Link from "next/link";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

const viewLabels = {
  "nouveaux-leads": "Nouveaux leads du jour",
  "taches-en-retard": "Tâches en retard",
} as const;

type ContactsView = keyof typeof viewLabels;

type ContactsPageProps = {
  searchParams: Promise<{ vue?: string }>;
};

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const params = await searchParams;
  const view: ContactsView | undefined =
    params.vue && params.vue in viewLabels
      ? (params.vue as ContactsView)
      : undefined;
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const crm = await services.getCrm(user.id, tenant.id, {
    view: view ?? "tous",
  });

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">CRM</p>
          <h1 className="mt-1 text-4xl font-bold">Contacts et leads</h1>
        </div>
        <Link
          href="/contacts/doublons"
          className="inline-flex rounded-md bg-[#08111f] px-4 py-3 font-semibold text-white"
        >
          Revoir les doublons
        </Link>
      </header>

      {view ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#0b8f84] bg-[#0b8f84]/5 px-4 py-3">
          <span className="rounded-full bg-[#0b8f84] px-3 py-1 text-sm font-semibold text-white">
            Filtre actif : {viewLabels[view]}
          </span>
          <Link
            href="/contacts"
            className="text-sm font-semibold text-[#0b8f84] underline-offset-4 hover:underline"
          >
            Retirer le filtre
          </Link>
        </div>
      ) : null}

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Contacts</h2>
        {crm.contacts.length === 0 ? (
          <EmptyState
            title="Aucun contact pour le moment."
            detail="Les contacts arrivent automatiquement depuis le formulaire de votre site, un import CSV ou une saisie manuelle."
            actionLabel="Vérifier mon site et son formulaire"
            actionHref="/mon-site"
          />
        ) : (
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
                    <td className="py-3 font-semibold">
                      <Link
                        href={`/contacts/${contact.id}`}
                        className="text-slate-950 underline-offset-4 hover:underline"
                      >
                        {contact.name}
                      </Link>
                    </td>
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
        )}
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">
            {view === "nouveaux-leads" ? "Leads reçus aujourd'hui" : "Leads"}
          </h2>
          {crm.leads.length === 0 ? (
            <EmptyState
              title={
                view === "nouveaux-leads"
                  ? "Aucun lead reçu aujourd'hui."
                  : "Aucun lead enregistré."
              }
              detail="Chaque demande envoyée depuis votre site public crée un lead ici, avec le contact et la tâche de suivi associés."
              actionLabel="Ouvrir la gestion du site"
              actionHref="/mon-site"
            />
          ) : (
            <div className="mt-4 grid gap-3">
              {crm.leads.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/contacts/${lead.contactId}`}
                  className="rounded-md border border-slate-200 px-4 py-3 transition hover:border-[#0b8f84]"
                >
                  <p className="font-semibold">{lead.status}</p>
                  <p className="text-sm text-slate-500">
                    {lead.source} - {lead.pagePath}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">
            {view === "taches-en-retard" ? "Tâches en retard" : "Taches de suivi"}
          </h2>
          {crm.tasks.length === 0 ? (
            <EmptyState
              title={
                view === "taches-en-retard"
                  ? "Aucune tâche en retard. Tout est à jour."
                  : "Aucune tâche de suivi."
              }
              detail="Les tâches gardent la trace des relances à faire pour chaque contact ou opportunité."
              actionLabel="Voir les opportunités"
              actionHref="/opportunites"
            />
          ) : (
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
          )}
        </div>
      </section>

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Timeline</h2>
        {crm.activities.length === 0 ? (
          <EmptyState
            title="Aucune activité enregistrée."
            detail="La timeline retrace automatiquement les événements métier : nouveaux leads, tâches, changements d'opportunités."
            actionLabel="Retour au centre de pilotage"
            actionHref="/aujourdhui"
          />
        ) : (
          <div className="mt-4 grid gap-3">
            {crm.activities.map((activity) => (
              <div key={activity.id} className="rounded-md border border-slate-200 px-4 py-3">
                <p className="font-semibold">{activity.summary}</p>
                <p className="text-sm text-slate-500">{activity.type}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyState({
  title,
  detail,
  actionLabel,
  actionHref,
}: {
  title: string;
  detail: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <div className="mt-4 rounded-md border border-dashed border-slate-300 px-4 py-5">
      <p className="font-semibold text-slate-700">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
      <Link
        href={actionHref}
        className="mt-3 inline-block text-sm font-semibold text-[#0b8f84] underline-offset-4 hover:underline"
      >
        {actionLabel}
      </Link>
    </div>
  );
}
