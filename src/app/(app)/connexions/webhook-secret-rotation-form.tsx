"use client";

import { KeyRound } from "lucide-react";
import { useActionState } from "react";
import {
  generateWebhookSecretAction,
  type GeneratedWebhookSecretState,
} from "@/app/actions";

const initialState: GeneratedWebhookSecretState = {
  secret: null,
  error: null,
};

export function WebhookSecretRotationForm({
  endpointId,
}: {
  endpointId: string;
}) {
  const [state, action, pending] = useActionState(
    generateWebhookSecretAction,
    initialState,
  );

  return (
    <form action={action} className="mt-4 grid gap-3">
      <input name="endpointId" type="hidden" value={endpointId} />
      <button
        className="inline-flex items-center justify-center gap-2 rounded-md bg-[#08111f] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending}
      >
        <KeyRound size={16} aria-hidden />
        {pending ? "Generation..." : "Generer un nouveau secret"}
      </button>
      {state.secret ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
          <p className="font-semibold">Secret affiche une seule fois</p>
          <code className="mt-2 block overflow-x-auto rounded-md bg-white px-3 py-2 text-xs text-slate-900">
            {state.secret}
          </code>
        </div>
      ) : null}
      {state.error ? (
        <p className="text-sm font-semibold text-red-700">{state.error}</p>
      ) : null}
    </form>
  );
}
