"use client";

export default function SelfImprovementErrorPage({
  reset,
}: {
  reset: () => void;
}) {
  return (
    <div className="grid gap-4 border border-red-200 bg-white p-6">
      <h1 className="text-2xl font-bold">Amélioration continue indisponible</h1>
      <p className="text-sm text-slate-600">
        Les signaux n&apos;ont pas pu être chargés. Aucune modification automatique
        n&apos;a été effectuée.
      </p>
      <button
        onClick={reset}
        className="w-fit rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white"
      >
        Réessayer
      </button>
    </div>
  );
}
