import { createConversationModelPlanAction } from "./actions";

export function ModelPlanForm({ threadId, sourceMessageId, state, idempotencyKey }: {
  threadId: string; sourceMessageId: string; state: string; idempotencyKey: string;
}) {
  return <section aria-label="Brouillon par intelligence artificielle" className="border-t border-slate-200 p-4 lg:p-5">
    <h2 className="text-lg font-bold">Préparer un brouillon avec l’IA</h2>
    {state === "ready" ? <form action={createConversationModelPlanAction} className="mt-3 grid gap-3">
      <input type="hidden" name="threadId" value={threadId} /><input type="hidden" name="sourceMessageId" value={sourceMessageId} /><input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <p className="text-sm text-slate-600">OpenAI propose une clarification ou un brouillon de relance à partir du dernier message. Rien ne sera exécuté automatiquement. Coût maximal réservé : 0,025 USD par demande, y compris si la génération échoue. Le budget serveur reste plafonné.</p>
      <label className="flex items-start gap-2 text-sm"><input required type="checkbox" name="modelConsent" value="true" className="mt-1" />J’autorise l’envoi du dernier message de ce fil à OpenAI et le coût maximal indiqué pour cette demande.</label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="modelExternalConsent" value="true" className="mt-1" />J’autorise aussi l’envoi des extraits vérifiés des pièces jointes de ce message. Sans cette confirmation, une demande contenant ces extraits sera refusée.</label>
      <button className="justify-self-start rounded-md bg-slate-900 px-4 py-2 font-semibold text-white">Générer le brouillon</button>
    </form> : <p className="mt-2 text-sm text-slate-600">La génération OpenAI est désactivée tant qu’une clé serveur et un budget autorisé ne sont pas configurés. Les propositions du serveur restent identifiées comme des simulations.</p>}
  </section>;
}
