import Link from "next/link";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ContactDuplicatesPage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const candidates = await services.getContactDuplicateCandidates(user.id, tenant.id);

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Qualite CRM
          </p>
          <h1 className="mt-1 text-4xl font-bold">Doublons contacts</h1>
          <p className="mt-2 text-slate-500">
            {candidates.length} rapprochement
            {candidates.length > 1 ? "s" : ""} probable
            {candidates.length > 1 ? "s" : ""} a verifier.
          </p>
        </div>
        <Link
          href="/contacts"
          className="inline-flex rounded-md border border-slate-300 px-4 py-3 font-semibold"
        >
          Retour aux contacts
        </Link>
      </header>

      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Candidats a verifier</h2>
        <div className="mt-5 grid gap-4">
          {candidates.length === 0 ? (
            <div className="rounded-md border border-slate-200 px-4 py-5 text-slate-500">
              Aucun doublon probable detecte pour le moment.
            </div>
          ) : null}
          {candidates.map((candidate) => (
            <article
              key={candidate.id}
              className="grid gap-4 rounded-md border border-slate-200 px-4 py-4 lg:grid-cols-[1fr_1fr_auto]"
            >
              <ContactSummary title="Contact A" contact={candidate.left} />
              <ContactSummary title="Contact B" contact={candidate.right} />
              <div className="flex flex-col justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {candidate.reasons.map((reason) => (
                    <span
                      key={reason.key}
                      className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-950"
                    >
                      {reason.label}
                    </span>
                  ))}
                </div>
                <Link
                  href={candidate.actionHref}
                  className="inline-flex justify-center rounded-md bg-[#08111f] px-4 py-3 text-sm font-semibold text-white"
                >
                  Comparer
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ContactSummary({
  title,
  contact,
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
  };
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {title}
      </p>
      <Link
        href={`/contacts/${contact.id}`}
        className="mt-1 block font-bold text-slate-950 underline-offset-4 hover:underline"
      >
        {contact.name}
      </Link>
      <p className="mt-1 text-sm text-slate-500">{contact.email}</p>
      <p className="text-sm text-slate-500">{contact.phone || "Telephone non renseigne"}</p>
      <p className="mt-2 text-sm">
        {contact.status} - {contact.source}
      </p>
      {contact.tags.length > 0 ? (
        <p className="mt-2 text-xs text-slate-500">{contact.tags.join(", ")}</p>
      ) : null}
    </div>
  );
}
