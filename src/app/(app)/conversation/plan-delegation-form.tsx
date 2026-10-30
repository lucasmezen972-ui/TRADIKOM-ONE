"use client";

import { UserRoundCheck } from "lucide-react";
import { useState } from "react";
import { delegateConversationPlanAction } from "@/app/(app)/conversation/actions";

export type PlanDelegationTargetOption = {
  userId: string;
  name: string;
  email: string;
  role: "owner" | "administrator" | "manager";
};

export function PlanDelegationForm({
  planId,
  targets,
  expectedDelegationVersion,
  idempotencyKey,
}: {
  planId: string;
  targets: PlanDelegationTargetOption[];
  expectedDelegationVersion: number;
  idempotencyKey: string;
}) {
  const [delegatedToUserId, setDelegatedToUserId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const selectedTarget = targets.find(
    (target) => target.userId === delegatedToUserId,
  );
  const descriptionId = `delegation-description-${planId}`;
  const selectedId = `delegation-selected-${planId}`;
  const confirmationId = `delegation-confirmation-${planId}`;
  const isReassignment = expectedDelegationVersion > 0;

  return (
    <form
      action={delegateConversationPlanAction}
      className="min-w-0 rounded-md border border-blue-200 bg-blue-50/70 p-3"
    >
      <input type="hidden" name="planId" value={planId} />
      <input
        type="hidden"
        name="expectedDelegationVersion"
        value={expectedDelegationVersion}
      />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div>
        <p className="text-sm font-bold text-blue-950">
          {isReassignment ? "Réaffecter la décision" : "Déléguer la décision"}
        </p>
        <p id={descriptionId} className="mt-1 text-xs leading-5 text-blue-900">
          Vous confiez l’approbation, l’annulation ou la modification de cette
          version. Le plan n’est pas exécuté par cette action.
        </p>
      </div>

      <label
        className="mt-3 block text-xs font-bold text-blue-950"
        htmlFor={`delegated-to-${planId}`}
      >
        Membre responsable
      </label>
      <select
        id={`delegated-to-${planId}`}
        name="delegatedToUserId"
        required
        value={delegatedToUserId}
        onChange={(event) => {
          setDelegatedToUserId(event.target.value);
          setConfirmed(false);
        }}
        aria-describedby={`${descriptionId} ${selectedId}`}
        className="mt-2 min-h-11 w-full min-w-0 rounded-md border border-blue-300 bg-white px-3 py-2 text-sm text-slate-950"
      >
        <option value="">Choisir un membre autorisé</option>
        {targets.map((target) => (
          <option key={target.userId} value={target.userId}>
            {target.name} — {roleLabel(target.role)} — {target.email}
          </option>
        ))}
      </select>
      <p
        id={selectedId}
        aria-live="polite"
        className="mt-2 break-words text-xs text-blue-900"
      >
        {selectedTarget
          ? `${selectedTarget.name} · ${roleLabel(selectedTarget.role)} · ${selectedTarget.email}`
          : "Seuls les propriétaires, administrateurs et managers ayant accès à ce fil sont proposés."}
      </p>

      <label
        className={`mt-3 flex min-h-11 items-start gap-3 rounded-md border px-3 py-2 text-sm ${
          selectedTarget
            ? "cursor-pointer border-blue-200 bg-white text-blue-950"
            : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500"
        }`}
      >
        <input
          type="checkbox"
          name="delegationConfirmed"
          value="true"
          checked={confirmed}
          disabled={!selectedTarget}
          onChange={(event) => setConfirmed(event.target.checked)}
          aria-describedby={confirmationId}
          className="mt-1 h-4 w-4 shrink-0"
        />
        <span id={confirmationId} className="leading-5">
          {selectedTarget
            ? `Je confirme confier cette décision à ${selectedTarget.name}.`
            : "Choisissez d’abord le membre qui recevra la décision."}
        </span>
      </label>

      <button
        disabled={!selectedTarget || !confirmed}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-300 sm:w-auto"
      >
        <UserRoundCheck size={17} aria-hidden />
        {isReassignment ? "Confirmer la réaffectation" : "Déléguer la décision"}
      </button>
    </form>
  );
}

function roleLabel(role: PlanDelegationTargetOption["role"]) {
  return {
    owner: "Propriétaire",
    administrator: "Administrateur",
    manager: "Manager",
  }[role];
}
