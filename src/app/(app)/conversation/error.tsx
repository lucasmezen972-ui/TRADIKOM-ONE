"use client";

export default function ConversationError({ reset }: { reset: () => void }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-rose-950">
      <h1 className="text-xl font-bold">La conversation est indisponible</h1>
      <p className="mt-2 text-sm">
        Le fil n&apos;a pas pu être chargé. Aucun message n&apos;a été envoyé à un
        service externe.
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded-md bg-rose-900 px-4 py-2 text-sm font-semibold text-white"
      >
        Réessayer
      </button>
    </div>
  );
}
