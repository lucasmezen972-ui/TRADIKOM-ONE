import { notFound } from "next/navigation";
import {
  addContactNoteAction,
  completeContactTaskAction,
  createContactTaskAction,
  updateContactAction,
  updateContactConsentAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

const contactStatuses = [
  "Nouveau",
  "A qualifier",
  "Rendez-vous prevu",
  "Devis envoye",
  "Gagne",
  "Perdu",
];

type ContactDetailPageProps = {
  params: Promise<{ contactId: string }>;
};

export default async function ContactDetailPage({
  params,
}: ContactDetailPageProps) {
  const { contactId } = await params;
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const [detail, members] = await Promise.all([
    services.getContactDetail(user.id, tenant.id, contactId),
    services.getTenantMembers(user.id, tenant.id),
  ]);

  if (!detail) {
    notFound();
  }

  const { contact, notes, consent, tasks, activities, opportunities } = detail;
  const defaultDueAt = toDateInputValue(
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  );

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Fiche contact
          </p>
          <h1 className="mt-1 text-4xl font-bold">{contact.name}</h1>
          <p className="mt-2 text-slate-500">
            {contact.email} - {contact.phone || "Telephone non renseigne"}
          </p>
        </div>
        <span className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
          {contact.status}
        </span>
      </header>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <form
          action={updateContactAction}
          className="rounded-lg bg-white p-5 shadow-sm"
        >
          <input type="hidden" name="contactId" value={contact.id} />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">Profil</h2>
              <p className="mt-1 text-sm text-slate-500">
                Informations de qualification et responsable.
              </p>
            </div>
            <button className="rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
              Enregistrer
            </button>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold">
              Nom
              <input
                required
                name="name"
                defaultValue={contact.name}
                className="rounded-md border border-slate-200 px-4 py-3 font-normal"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Telephone
              <input
                name="phone"
                defaultValue={contact.phone}
                className="rounded-md border border-slate-200 px-4 py-3 font-normal"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Statut
              <select
                name="status"
                defaultValue={contact.status}
                className="rounded-md border border-slate-200 px-4 py-3 font-normal"
              >
                {contactStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Responsable
              <select
                name="assignedUserId"
                defaultValue={contact.assignedUserId ?? ""}
                className="rounded-md border border-slate-200 px-4 py-3 font-normal"
              >
                <option value="">Non assigne</option>
                {members.map((member) => (
                  <option key={member.user.id} value={member.user.id}>
                    {member.user.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold md:col-span-2">
              Tags
              <input
                name="tags"
                defaultValue={contact.tags.join(", ")}
                placeholder="urgent, devis, client pro"
                className="rounded-md border border-slate-200 px-4 py-3 font-normal"
              />
            </label>
          </div>
        </form>

        <form
          action={updateContactConsentAction}
          className="rounded-lg bg-white p-5 shadow-sm"
        >
          <input type="hidden" name="contactId" value={contact.id} />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">Consentement</h2>
              <p className="mt-1 text-sm text-slate-500">
                Base commerciale et notice de confidentialite.
              </p>
            </div>
            <button className="rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
              Mettre a jour
            </button>
          </div>
          <div className="mt-5 grid gap-4">
            <label className="flex items-center gap-3 text-sm font-semibold">
              <input
                type="checkbox"
                name="marketingOptIn"
                defaultChecked={consent?.marketingOptIn ?? false}
                className="h-4 w-4"
              />
              Marketing autorise
            </label>
            <label className="flex items-center gap-3 text-sm font-semibold">
              <input
                type="checkbox"
                name="privacyNoticeAccepted"
                defaultChecked={Boolean(consent?.privacyNoticeAcceptedAt)}
                className="h-4 w-4"
              />
              Notice acceptee
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Conservation jusqu'au
              <input
                type="date"
                name="dataRetentionUntil"
                defaultValue={toDateInputValue(consent?.dataRetentionUntil)}
                className="rounded-md border border-slate-200 px-4 py-3 font-normal"
              />
            </label>
          </div>
        </form>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">Taches</h2>
              <p className="mt-1 text-sm text-slate-500">
                Suivi manuel et relances automatiques liees au contact.
              </p>
            </div>
          </div>
          <form action={createContactTaskAction} className="mt-5 grid gap-3">
            <input type="hidden" name="contactId" value={contact.id} />
            <input
              required
              name="title"
              placeholder="Appeler pour qualifier la demande"
              className="rounded-md border border-slate-200 px-4 py-3"
            />
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input
                required
                type="date"
                name="dueAt"
                defaultValue={defaultDueAt}
                className="rounded-md border border-slate-200 px-4 py-3"
              />
              <select
                name="assignedUserId"
                defaultValue={contact.assignedUserId ?? user.id}
                className="rounded-md border border-slate-200 px-4 py-3"
              >
                {members.map((member) => (
                  <option key={member.user.id} value={member.user.id}>
                    {member.user.name}
                  </option>
                ))}
              </select>
              <button className="rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
                Ajouter
              </button>
            </div>
          </form>
          <div className="mt-5 grid gap-3">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="grid gap-3 rounded-md border border-slate-200 px-4 py-3 md:grid-cols-[1fr_auto]"
              >
                <div>
                  <p className="font-semibold">{task.title}</p>
                  <p className="text-sm text-slate-500">
                    {task.status === "done" ? "Terminee" : "Ouverte"} -{" "}
                    {new Date(task.dueAt).toLocaleDateString("fr-FR")}
                  </p>
                </div>
                {task.status === "open" ? (
                  <form action={completeContactTaskAction}>
                    <input type="hidden" name="contactId" value={contact.id} />
                    <input type="hidden" name="taskId" value={task.id} />
                    <button className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold">
                      Terminer
                    </button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Notes</h2>
          <form action={addContactNoteAction} className="mt-5 grid gap-3">
            <input type="hidden" name="contactId" value={contact.id} />
            <textarea
              required
              name="body"
              rows={4}
              placeholder="Ajouter une note de suivi"
              className="rounded-md border border-slate-200 px-4 py-3"
            />
            <button className="rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
              Ajouter la note
            </button>
          </form>
          <div className="mt-5 grid gap-3">
            {notes.map((note) => (
              <div key={note.id} className="rounded-md border border-slate-200 px-4 py-3">
                <p>{note.body}</p>
                <p className="mt-2 text-sm text-slate-500">
                  {new Date(note.createdAt).toLocaleString("fr-FR")}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Opportunites</h2>
          <div className="mt-4 grid gap-3">
            {opportunities.map((opportunity) => (
              <div
                key={opportunity.id}
                className="rounded-md border border-slate-200 px-4 py-3"
              >
                <p className="font-semibold">{opportunity.stageName}</p>
                <p className="text-sm text-slate-500">
                  {formatCurrency(opportunity.valueCents)} - Prochaine action :{" "}
                  {opportunity.nextFollowUpAt
                    ? new Date(opportunity.nextFollowUpAt).toLocaleDateString("fr-FR")
                    : "non planifiee"}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Timeline</h2>
          <div className="mt-4 grid gap-3">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="rounded-md border border-slate-200 px-4 py-3"
              >
                <p className="font-semibold">{activity.summary}</p>
                <p className="text-sm text-slate-500">
                  {activity.type} - {new Date(activity.createdAt).toLocaleString("fr-FR")}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function toDateInputValue(value?: string) {
  return value ? value.slice(0, 10) : "";
}

function formatCurrency(valueCents: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(valueCents / 100);
}
