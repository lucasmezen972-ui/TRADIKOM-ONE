import Link from "next/link";
import { notFound } from "next/navigation";
import { mergeContactsAction } from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

type ContactDuplicateReviewPageProps = {
  params: Promise<{ leftContactId: string; rightContactId: string }>;
};

export default async function ContactDuplicateReviewPage({
  params,
}: ContactDuplicateReviewPageProps) {
  const { leftContactId, rightContactId } = await params;
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const pair = await services
    .getDuplicatePairDetail(user.id, tenant.id, leftContactId, rightContactId)
    .catch(() => null);

  if (!pair) {
    notFound();
  }

  const fieldRows = [
    {
      key: "nameSource",
      label: "Nom",
      leftValue: pair.left.name,
      rightValue: pair.right.name,
      defaultContactId:
        pair.defaultFieldSources.name === "merged" ? pair.right.id : pair.left.id,
    },
    {
      key: "emailSource",
      label: "Email",
      leftValue: pair.left.email,
      rightValue: pair.right.email,
      defaultContactId:
        pair.defaultFieldSources.email === "merged" ? pair.right.id : pair.left.id,
    },
    {
      key: "phoneSource",
      label: "Telephone",
      leftValue: pair.left.phone,
      rightValue: pair.right.phone,
      defaultContactId:
        pair.defaultFieldSources.phone === "merged" ? pair.right.id : pair.left.id,
    },
    {
      key: "statusSource",
      label: "Statut",
      leftValue: pair.left.status,
      rightValue: pair.right.status,
      defaultContactId:
        pair.defaultFieldSources.status === "merged" ? pair.right.id : pair.left.id,
    },
    {
      key: "sourceSource",
      label: "Source",
      leftValue: pair.left.source,
      rightValue: pair.right.source,
      defaultContactId:
        pair.defaultFieldSources.source === "merged" ? pair.right.id : pair.left.id,
    },
    {
      key: "assignedUserIdSource",
      label: "Responsable",
      leftValue: pair.left.assignedUserId ?? "Non assigne",
      rightValue: pair.right.assignedUserId ?? "Non assigne",
      defaultContactId:
        pair.defaultFieldSources.assignedUserId === "merged"
          ? pair.right.id
          : pair.left.id,
    },
  ];

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Fusion controlee
          </p>
          <h1 className="mt-1 text-4xl font-bold">Comparer les contacts</h1>
          <p className="mt-2 text-slate-500">
            Aucune fusion automatique : choisissez le survivant, les champs et le
            motif.
          </p>
        </div>
        <Link
          href="/contacts/doublons"
          className="inline-flex rounded-md border border-slate-300 px-4 py-3 font-semibold"
        >
          Retour aux doublons
        </Link>
      </header>

      <form action={mergeContactsAction} className="grid gap-6">
        <input type="hidden" name="leftContactId" value={pair.left.id} />
        <input type="hidden" name="rightContactId" value={pair.right.id} />

        <section className="grid gap-5 lg:grid-cols-2">
          <ContactPanel
            title="Contact A"
            contact={pair.left}
            defaultChecked
          />
          <ContactPanel title="Contact B" contact={pair.right} />
        </section>

        <section className="rounded-lg bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">Indices detectes</h2>
              <p className="mt-1 text-sm text-slate-500">
                Ces signaux justifient une revue manuelle.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {pair.reasons.map((reason) => (
                <span
                  key={reason.key}
                  className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-950"
                >
                  {reason.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Choix des champs</h2>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-3">Champ</th>
                  <th>Contact A</th>
                  <th>Contact B</th>
                </tr>
              </thead>
              <tbody>
                {fieldRows.map((field) => (
                  <tr key={field.key} className="border-t border-slate-100">
                    <td className="py-3 font-semibold">{field.label}</td>
                    <td>
                      <label className="flex items-center gap-3">
                        <input
                          type="radio"
                          name={field.key}
                          value={pair.left.id}
                          defaultChecked={field.defaultContactId === pair.left.id}
                        />
                        <span>{field.leftValue || "-"}</span>
                      </label>
                    </td>
                    <td>
                      <label className="flex items-center gap-3">
                        <input
                          type="radio"
                          name={field.key}
                          value={pair.right.id}
                          defaultChecked={field.defaultContactId === pair.right.id}
                        />
                        <span>{field.rightValue || "-"}</span>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_0.8fr]">
          <div className="rounded-lg bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">Confirmation</h2>
            <label className="mt-5 grid gap-2 text-sm font-semibold">
              Motif de fusion
              <textarea
                required
                name="reason"
                rows={4}
                placeholder="Exemple : meme client confirme par telephone"
                className="rounded-md border border-slate-200 px-4 py-3 font-normal"
              />
            </label>
            <label className="mt-5 flex items-start gap-3 text-sm font-semibold">
              <input
                required
                type="checkbox"
                name="confirmMerge"
                className="mt-1 h-4 w-4"
              />
              Je confirme la fusion et la reaffectation des donnees associees.
            </label>
            <button className="mt-5 rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
              Fusionner les contacts
            </button>
          </div>

          <div className="rounded-lg bg-slate-950 p-5 text-white shadow-sm">
            <h2 className="text-xl font-bold">Apercu securite</h2>
            <div className="mt-4 grid gap-3 text-sm text-white/75">
              <p>Les leads, opportunites, notes, taches et activites seront rattaches au survivant.</p>
              <p>Les tags seront combines et le consentement le plus protecteur sera conserve.</p>
              <p>Un enregistrement de fusion et un audit garderont la trace du contact absorbe.</p>
            </div>
          </div>
        </section>
      </form>
    </div>
  );
}

function ContactPanel({
  title,
  contact,
  defaultChecked = false,
}: {
  title: string;
  contact: {
    id: string;
    name: string;
    email: string;
    phone: string;
    status: string;
    source: string;
    tags: string[];
    assignedUserId?: string;
    updatedAt: string;
  };
  defaultChecked?: boolean;
}) {
  return (
    <section className="rounded-lg bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            {title}
          </p>
          <h2 className="mt-1 text-2xl font-bold">{contact.name}</h2>
        </div>
        <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold">
          <input
            type="radio"
            name="survivorContactId"
            value={contact.id}
            defaultChecked={defaultChecked}
          />
          Survivant
        </label>
      </div>
      <dl className="mt-5 grid gap-3 text-sm">
        <DetailRow label="Email" value={contact.email} />
        <DetailRow label="Telephone" value={contact.phone || "Non renseigne"} />
        <DetailRow label="Statut" value={contact.status} />
        <DetailRow label="Source" value={contact.source} />
        <DetailRow label="Tags" value={contact.tags.join(", ") || "-"} />
        <DetailRow
          label="Mise a jour"
          value={new Date(contact.updatedAt).toLocaleString("fr-FR")}
        />
      </dl>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border border-slate-100 px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
