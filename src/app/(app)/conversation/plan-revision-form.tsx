"use client";

import { PencilLine } from "lucide-react";
import { useState } from "react";
import { reviseConversationPlanAction } from "@/app/(app)/conversation/actions";

export function PlanRevisionForm({
  planId,
  taskTitle,
}: {
  planId: string;
  taskTitle: string;
}) {
  const [nextTaskTitle, setNextTaskTitle] = useState(taskTitle);
  const normalizedTitle = nextTaskTitle.trim();
  const hasChanged = normalizedTitle !== taskTitle.trim();
  const canSubmit =
    hasChanged && normalizedTitle.length >= 3 && normalizedTitle.length <= 160;
  const helpId = `task-title-help-${planId}`;

  return (
    <form
      action={reviseConversationPlanAction}
      className="rounded-md border border-violet-200 bg-violet-50/60 p-3"
    >
      <input type="hidden" name="planId" value={planId} />
      <label
        className="text-xs font-bold text-violet-950"
        htmlFor={`task-title-${planId}`}
      >
        Nouveau titre de la tâche
      </label>
      <input
        id={`task-title-${planId}`}
        name="taskTitle"
        required
        minLength={3}
        maxLength={160}
        value={nextTaskTitle}
        onChange={(event) => setNextTaskTitle(event.target.value)}
        aria-describedby={helpId}
        className="mt-2 w-full rounded-md border border-violet-300 bg-white px-3 py-2 text-sm"
      />
      <button
        disabled={!canSubmit}
        className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-violet-300"
      >
        <PencilLine size={16} aria-hidden />
        Modifier le plan
      </button>
      <p id={helpId} aria-live="polite" className="mt-2 text-xs text-violet-900">
        {hasChanged
          ? "Une nouvelle version devra être approuvée."
          : "Modifiez le titre pour créer une nouvelle version."}
      </p>
    </form>
  );
}
