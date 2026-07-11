import {
  approveWorkflowRunAction,
  cancelWorkflowRunAction,
  rejectWorkflowRunAction,
  retryWorkflowRunAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import type { WorkflowRun } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const runs = await services.getWorkflowRuns(user.id, tenant.id);

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
