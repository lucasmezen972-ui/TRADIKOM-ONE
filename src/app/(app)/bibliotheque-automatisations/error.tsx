"use client";

import { RotateCcw } from "lucide-react";

export default function AutomationMarketplaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-lg border border-rose-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Bibliothèque indisponible</h1>
      <p className="mt-2 text-slate-600">
        Les paquets privés ne peuvent pas être chargés. Aucune automatisation n&apos;a été exécutée.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-slate-950 px-4 py-2 font-semibold text-white"
      >
        <RotateCcw size={18} aria-hidden />
        Réessayer
      </button>
    </div>
  );
}
