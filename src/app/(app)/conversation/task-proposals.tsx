import Link from "next/link";
import type { ConversationTaskProposal } from "@/modules/conversation-hub/task-proposals";
import { decideNativeConversationTaskAction } from "./actions";

export function TaskProposals({ proposals }: { proposals: ConversationTaskProposal[] }) {
  if (!proposals.length) return null;
  return <section aria-label="Propositions de tâches CRM" className="grid gap-4 border-t border-slate-200 p-4 lg:p-5">
    <h2 className="text-lg font-bold">Vos propositions de suivi</h2>
    {proposals.map(p => <article key={p.id} id={`task-proposal-${p.id}`} aria-label={p.title} className="min-w-0 rounded-lg border border-teal-200 bg-teal-50/50 p-4">
      <p role="status" className="text-sm font-semibold text-teal-900">{p.status === "executed" ? "Tâche créée dans le CRM" : p.status === "rejected" ? "Proposition refusée · aucune tâche créée" : "À confirmer · aucune tâche créée"}</p>
      <h3 className="mt-2 break-words font-bold">{p.title}</h3>
      <dl className="mt-2 grid gap-1 text-sm text-slate-700">
        <div><dt className="inline font-semibold">Contact : </dt><dd className="inline break-words">{p.contactName}</dd></div>
        <div><dt className="inline font-semibold">Échéance : </dt><dd className="inline">{new Intl.DateTimeFormat("fr-FR", { dateStyle:"medium", timeStyle:"short", timeZone:"America/Martinique" }).format(new Date(p.dueAt))} (Martinique)</dd></div>
      </dl>
      {p.canConfirm ? <form action={decideNativeConversationTaskAction} className="mt-3 grid gap-3">
        <input type="hidden" name="proposalId" value={p.id} /><input type="hidden" name="decision" value="approved" />
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="teamVisibilityConfirmed" value="true" required className="mt-1" />Je confirme la création de cette tâche, son attribution à mon compte et sa visibilité par l’équipe de cette entreprise.</label>
        <button className="justify-self-start rounded-md bg-teal-800 px-4 py-2 font-semibold text-white">Confirmer et créer la tâche</button>
      </form> : p.status === "pending" && (p.expired || p.contextChanged) ? <p className="mt-3 text-sm text-amber-900">L’échéance ou le contexte a changé. Préparez une nouvelle proposition avant de confirmer.</p> : null}
      {p.canReject ? <form action={decideNativeConversationTaskAction} className="mt-3">
        <input type="hidden" name="proposalId" value={p.id} /><input type="hidden" name="decision" value="rejected" />
        <button className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">Refuser la proposition</button>
      </form> : null}
      {p.status === "executed" ? <p className="mt-3 text-sm"><Link className="font-semibold underline" href={`/contacts/${encodeURIComponent(p.contactId)}`}>Voir la tâche sur la fiche contact</Link> · Aucun message externe envoyé.</p> : null}
    </article>)}
  </section>;
}
