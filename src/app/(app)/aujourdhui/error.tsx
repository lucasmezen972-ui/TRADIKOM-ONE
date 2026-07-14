"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

export default function TodayError({ reset }: { reset: () => void }) {
  return (
    <div className="border border-red-200 bg-white p-6">
      <AlertTriangle className="text-red-600" size={24} aria-hidden />
      <h1 className="mt-4 text-2xl font-bold">Le centre de pilotage est indisponible.</h1>
      <p className="mt-2 text-slate-600">
        Les données n'ont pas pu être chargées. Aucune information interne n'a été affichée.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-5 inline-flex items-center gap-2 rounded-md bg-[#08111f] px-4 py-3 font-semibold text-white"
      >
        <RotateCcw size={17} aria-hidden />
        Réessayer
      </button>
    </div>
  );
}
