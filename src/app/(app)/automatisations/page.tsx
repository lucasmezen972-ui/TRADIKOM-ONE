import {
  approveWorkflowRunAction,
  cancelWorkflowQueueEventAction,
  cancelWorkflowRunAction,
  rejectWorkflowRunAction,
  retryWorkflowDeadLetterAction,
  retryWorkflowRunAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import type {
  WorkflowDeadLetterEvent,
  WorkflowQueueEvent,
  WorkflowQueueOverview,
  WorkflowQueueStatus,
  WorkflowRun,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const [runs, deadLetters, queue] = await Promise.all([
    services.getWorkflowRuns(user.id, tenant.id),
    services.getWorkflowDeadLetters(user.id, tenant.id),
    services.getWorkflowQueueOverview(user.id, tenant.id),
  ]);

  return (
    <div className="grid gap-6">
      <header>
        <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
          Moteur workflow
        </p>
        <h1 className="mt-1 text-4xl font-bold">Automatisations</h1>
      </header>
      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Workflow par defaut</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {["lead.created", "create_task", "send_mock_email"].map((item) => (
            <div key={item} className="rounded-md border border-slate-200 px-4 py-3">
              {item}
            </div>
          ))}
        </div>
      </section>
      <WorkflowQueuePanel queue={queue} />
      <section className="rounded-lg bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Incidents a traiter</h2>
            <p className="mt-1 text-sm text-slate-500">
              Evenements arrives en echec terminal apres les tentatives
              automatiques.
            </p>
          </div>
          <span className="rounded-full bg-rose-50 px-3 py-1 text-sm font-semibold text-rose-700">
            {deadLetters.length}
          </span>
        </div>
        <div className="mt-4 grid gap-3">
          {deadLetters.length === 0 ? (
            <p className="rounded-md border border-slate-200 px-4 py-3 text-sm text-slate-500">
              Aucun incident workflow terminal.
            </p>
          ) : (
            deadLetters.map((event) => (
              <DeadLetterCard key={event.id} event={event} />
            ))
          )}
        </div>
      </section>
      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Historique</h2>
        <div className="mt-4 grid gap-3">
          {runs.map((run) => (
            <div key={run.id} className="rounded-md border border-slate-200 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{run.summary}</p>
                  <p className="text-sm text-slate-500">
                    {run.triggerName} - {run.status}
                  </p>
                </div>
                <WorkflowRunControls run={run} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function WorkflowQueuePanel({ queue }: { queue: WorkflowQueueOverview }) {
  return (
    <section className="rounded-lg bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">File des evenements</h2>
          <p className="mt-1 text-sm text-slate-500">
            Suivi des evenements durables avant traitement par le worker.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
          {queue.activeEvents.length} actif(s)
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-5">
        {queue.summary.map((item) => (
          <div
            key={item.status}
            className="rounded-md border border-slate-200 px-3 py-3"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              {workflowQueueStatusLabel(item.status)}
            </p>
            <p className="mt-2 text-2xl font-bold">{item.count}</p>
            {item.oldestNextRunAt ? (
              <p className="mt-1 text-xs text-slate-500">
                Prochain {item.oldestNextRunAt}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3">
        {queue.activeEvents.length === 0 ? (
          <p className="rounded-md border border-slate-200 px-4 py-3 text-sm text-slate-500">
            Aucun evenement actif dans la file.
          </p>
        ) : (
          queue.activeEvents.map((event) => (
            <WorkflowQueueEventRow key={event.id} event={event} />
          ))
        )}
      </div>
    </section>
  );
}

function WorkflowQueueEventRow({ event }: { event: WorkflowQueueEvent }) {
  return (
    <div className="rounded-md border border-slate-200 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{event.eventType}</p>
          <p className="mt-1 text-sm text-slate-500">
            {workflowQueueStatusLabel(event.status)} - {event.attempts} tentative(s)
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Correlation {event.correlationId}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-right text-sm text-slate-600">
          <div>
            <p>Prochain passage {event.nextRunAt}</p>
            {event.lastRetryDelayMs > 0 ? (
              <p className="text-xs">Delai {event.lastRetryDelayMs} ms</p>
            ) : null}
            {event.failureClassification ? (
              <p className="text-xs">
                Cause {deadLetterFailureLabel(event.failureClassification)}
              </p>
            ) : null}
          </div>
          <form action={cancelWorkflowQueueEventAction}>
            <input name="eventId" type="hidden" value={event.id} />
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700"
              type="submit"
            >
              Annuler
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function DeadLetterCard({ event }: { event: WorkflowDeadLetterEvent }) {
  return (
    <div className="rounded-md border border-rose-200 bg-rose-50/40 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-rose-950">{event.eventType}</p>
          <p className="mt-1 text-sm text-rose-800">{event.lastError}</p>
          <p className="mt-2 text-xs text-slate-500">
            Correlation {event.correlationId}
          </p>
          {event.failureClassification ? (
            <p className="mt-1 text-xs text-slate-500">
              Cause {deadLetterFailureLabel(event.failureClassification)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2 text-right text-sm text-slate-600">
          <div>
            <p>{event.attempts} tentative(s)</p>
            {event.maxAttempts ? (
              <p className="text-xs">Maximum {event.maxAttempts}</p>
            ) : null}
            <p className="text-xs">{event.updatedAt}</p>
          </div>
          <form action={retryWorkflowDeadLetterAction}>
            <input name="eventId" type="hidden" value={event.id} />
            <button
              className="rounded-md border border-rose-300 bg-white px-3 py-1 text-sm font-semibold text-rose-700"
              type="submit"
            >
              Relancer
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function workflowQueueStatusLabel(status: WorkflowQueueStatus) {
  if (status === "pending") {
    return "En attente";
  }

  if (status === "processing") {
    return "En traitement";
  }

  if (status === "succeeded") {
    return "Reussis";
  }

  if (status === "failed") {
    return "Echoues";
  }

  return "Ignores";
}

function deadLetterFailureLabel(value: string) {
  if (value === "max_attempts_exceeded") {
    return "tentatives epuisees";
  }

  if (value === "handler_missing") {
    return "gestionnaire manquant";
  }

  if (value === "worker_lease_expired") {
    return "traitement interrompu";
  }

  return "erreur transitoire";
}

function WorkflowRunControls({ run }: { run: WorkflowRun }) {
  return (
    <div className="flex flex-wrap gap-2">
      {run.status === "approval_required" ? (
        <>
          <WorkflowButton
            action={approveWorkflowRunAction}
            label="Approuver"
            runId={run.id}
          />
          <WorkflowButton
            action={rejectWorkflowRunAction}
            label="Rejeter"
            runId={run.id}
          />
        </>
      ) : null}
      {["running", "waiting", "approval_required"].includes(run.status) ? (
        <WorkflowButton
          action={cancelWorkflowRunAction}
          label="Annuler"
          runId={run.id}
        />
      ) : null}
      {["failed", "rejected", "cancelled"].includes(run.status) ? (
        <WorkflowButton
          action={retryWorkflowRunAction}
          label="Relancer"
          runId={run.id}
        />
      ) : null}
    </div>
  );
}

function WorkflowButton({
  action,
  label,
  runId,
}: {
  action: (formData: FormData) => Promise<void>;
  label: string;
  runId: string;
}) {
  return (
    <form action={action}>
      <input name="runId" type="hidden" value={runId} />
      <button
        className="rounded-md border border-slate-300 px-3 py-1 text-sm font-semibold text-slate-700"
        type="submit"
      >
        {label}
      </button>
    </form>
  );
}
