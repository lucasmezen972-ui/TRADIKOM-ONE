import Link from "next/link";
import { createNativeConversationTaskAction } from "./actions";

export function NativeTaskForm({ threadId, sourceMessageId, contacts, idempotencyKey, dueAt }: {
  threadId: string; sourceMessageId: string; contacts: { id: string; name: string }[]; idempotencyKey: string; dueAt: string;
}) {
  return <section aria-label="Action réelle dans le CRM" className="border-t border-slate-200 bg-teal-50/50 p-4 lg:p-5">
    <h2 className="text-lg font-bold">Créer une vraie tâche de suivi</h2>
    <p className="mt-1 text-sm text-slate-600">Transformez votre dernier message en tâche pour un contact de cette entreprise. La tâche vous sera attribuée, avec une échéance sous 24 heures. Aucun message externe ne sera envoyé.</p>
    {contacts.length ? <form action={createNativeConversationTaskAction} className="mt-3 grid gap-3">
      <input type="hidden" name="threadId" value={threadId} /><input type="hidden" name="sourceMessageId" value={sourceMessageId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} /><input type="hidden" name="dueAt" value={dueAt} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">Contact à suivre<select name="contactId" required className="rounded-md border border-slate-300 bg-white p-2">{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-semibold">Titre de la tâche<input name="title" required minLength={3} maxLength={200} placeholder="Ex. Rappeler le contact au sujet de son devis" className="rounded-md border border-slate-300 bg-white p-2" /></label>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" required name="teamVisibilityConfirmed" value="true" className="mt-1" />Je confirme la création de cette tâche et sa visibilité par l’équipe de cette entreprise.</label>
      <button className="justify-self-start rounded-md bg-teal-800 px-4 py-2 font-semibold text-white">Créer la tâche dans le CRM</button>
    </form> : <p className="mt-3 text-sm">Ajoutez d’abord un contact dans <Link href="/contacts" className="font-semibold underline">votre CRM</Link>.</p>}
  </section>;
}
