import { createConversationGoalAction, changeConversationGoalAction } from "./actions";
import type { listGoalWatchesForThread } from "@/modules/goal-watch";

type Goal = Awaited<ReturnType<typeof listGoalWatchesForThread>>[number];
const states = { active: "Suivi autorisé", paused: "En pause", stopped: "Arrêté définitivement", consent_required: "Consentement requis" };

export function GoalWatchPanel({ threadId, goals, canWrite, creationIdempotencyKey }: {
  threadId: string; goals: Goal[]; canWrite: boolean; creationIdempotencyKey: string;
}) {
  return <section aria-label="Objectifs de cette conversation" className="border-t border-slate-200 p-4 lg:p-5">
    <h2 className="text-lg font-bold">Objectifs suivis</h2>
    <p className="mt-1 text-sm text-slate-600">Suivez un indicateur de cette entreprise. Les changements sont rapportés dans ce fil lors des évaluations. Vous pouvez suspendre le suivi ou l’arrêter définitivement. Les évaluations automatiques ne sont pas programmées sur cette préversion.</p>
    {goals.length === 0 ? <p className="mt-3 text-sm text-slate-500">Aucun suivi autorisé dans ce fil.</p> : <ul className="mt-4 grid gap-3">
      {goals.map((goal) => <li key={goal.goalId} className="rounded-lg border border-slate-200 p-3">
        <h3 className="font-semibold">{goal.title}</h3>
        <p role="status" className="mt-1 text-sm font-semibold">{states[goal.state]}</p>
        <p className="mt-1 text-sm text-slate-600">{goal.signalLabel} : {goal.operator === "gte" ? "au moins" : "au plus"} {goal.targetLabel}. Cadence souhaitée : {goal.cadenceMinutes / 60} heures.</p>
        {goal.latestEvaluation ? <p className="mt-1 text-sm">Dernier résultat : {goal.latestEvaluation.state === "met" ? "objectif atteint" : "objectif non atteint"}.</p> : null}
        {canWrite && goal.state !== "stopped" ? <div className="mt-3 flex flex-wrap items-start gap-3">
          {goal.state === "active" ? <Control goal={goal} action="pause"><button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold">Mettre en pause</button></Control>
            : <Control goal={goal} action="resume"><label className="flex items-start gap-2 text-sm"><input required type="checkbox" name="goalConsent" value="true" className="mt-1" />J’autorise le suivi de cet indicateur et les rapports dans ce fil.</label><button className="mt-2 rounded-md bg-teal-800 px-3 py-2 text-sm font-semibold text-white">{goal.state === "paused" ? "Reprendre le suivi" : "Autoriser le suivi"}</button></Control>}
          {goal.state !== "consent_required" ? <details className="text-sm"><summary className="cursor-pointer py-2 font-semibold text-red-800">Arrêter définitivement</summary><Control goal={goal} action="stop"><label className="mt-2 flex items-start gap-2"><input required type="checkbox" name="stopConfirmed" value="true" className="mt-1" />Je confirme l’arrêt définitif de cet objectif.</label><button className="mt-2 rounded-md bg-red-800 px-3 py-2 font-semibold text-white">Confirmer l’arrêt</button></Control></details> : null}
        </div> : null}
      </li>)}
    </ul>}
    {canWrite ? <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <summary className="cursor-pointer font-semibold">Suivre un nouvel objectif</summary>
      <form action={createConversationGoalAction} className="mt-4 grid gap-3">
        <input type="hidden" name="threadId" value={threadId} />
        <input type="hidden" name="idempotencyKey" value={creationIdempotencyKey} />
        <label className="grid gap-1 text-sm font-semibold">Nom de l’objectif<input name="title" required minLength={3} maxLength={120} className="rounded-md border border-slate-300 bg-white p-2" /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Indicateur<select name="signal" className="rounded-md border border-slate-300 bg-white p-2"><option value="contacts">Contacts actifs</option><option value="opportunities">Opportunités ouvertes</option><option value="published_websites">Sites publiés</option></select></label>
        <label className="grid gap-1 text-sm font-semibold">Condition<select name="operator" className="rounded-md border border-slate-300 bg-white p-2"><option value="gte">Au moins</option><option value="lte">Au plus</option></select></label>
        <label className="grid gap-1 text-sm font-semibold">Valeur cible<input name="target" required type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} defaultValue={1} className="rounded-md border border-slate-300 bg-white p-2" /></label>
        <label className="grid gap-1 text-sm font-semibold">Fréquence<select name="cadenceMinutes" defaultValue="1440" className="rounded-md border border-slate-300 bg-white p-2"><option value="60">Toutes les heures</option><option value="240">Toutes les 4 heures</option><option value="1440">Une fois par jour</option><option value="10080">Une fois par semaine</option></select></label></div>
        <label className="flex items-start gap-2 text-sm"><input required type="checkbox" name="goalConsent" value="true" className="mt-1" />J’autorise le suivi de cet indicateur de l’entreprise et les rapports dans cette conversation. Ce suivi n’envoie aucun message externe.</label>
        <button className="justify-self-start rounded-md bg-teal-800 px-4 py-2 font-semibold text-white">Autoriser cet objectif</button>
      </form>
    </details> : null}
  </section>;
}

function Control({ goal, action, children }: { goal: Goal; action: "pause" | "resume" | "stop"; children: React.ReactNode }) {
  return <form action={changeConversationGoalAction}>
    <input type="hidden" name="goalId" value={goal.goalId} /><input type="hidden" name="version" value={goal.version} /><input type="hidden" name="action" value={action} />{children}
  </form>;
}
