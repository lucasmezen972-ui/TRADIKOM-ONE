"use client";

import { useState, type DragEvent } from "react";
import Link from "next/link";
import {
  moveOpportunityStageAction,
  reorderOpportunityAction,
} from "@/app/actions";

export type BoardStage = {
  id: string;
  name: string;
};

export type BoardCard = {
  id: string;
  contactName: string;
  contactEmail: string;
  stageId: string;
  valueLabel: string;
  probability?: number;
  expectedCloseLabel?: string;
};

/**
 * Le tableau reste utilisable sans JavaScript : chaque carte porte un menu de
 * déplacement classique, soumis par formulaire. Le glisser-déposer n'est
 * qu'une amélioration ajoutée par-dessus, et il ne remplace jamais ces
 * contrôles — il est inutilisable au clavier et peu fiable sur mobile.
 */
export function PipelineBoard({
  stages,
  cards,
}: {
  stages: BoardStage[];
  cards: BoardCard[];
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [hoveredStage, setHoveredStage] = useState<string | null>(null);

  function handleDrop(event: DragEvent<HTMLDivElement>, stageId: string) {
    event.preventDefault();
    setHoveredStage(null);
    const opportunityId = event.dataTransfer.getData("text/plain") || draggedId;
    setDraggedId(null);
    if (!opportunityId) {
      return;
    }
    const card = cards.find((item) => item.id === opportunityId);
    if (!card || card.stageId === stageId) {
      return;
    }
    // La soumission passe par le même formulaire que les contrôles visibles :
    // aucune route parallèle, donc aucune garde contournée.
    const form = document.getElementById(
      `move-${opportunityId}`,
    ) as HTMLFormElement | null;
    const input = form?.elements.namedItem("stageId") as HTMLSelectElement | null;
    if (form && input) {
      input.value = stageId;
      form.requestSubmit();
    }
  }

  return (
    <div className="grid gap-4 overflow-x-auto md:grid-cols-2 xl:grid-cols-3">
      {stages.map((stage) => {
        const stageCards = cards.filter((card) => card.stageId === stage.id);
        return (
          <div
            key={stage.id}
            onDragOver={(event) => {
              event.preventDefault();
              setHoveredStage(stage.id);
            }}
            onDragLeave={() => setHoveredStage(null)}
            onDrop={(event) => handleDrop(event, stage.id)}
            className={`grid content-start gap-3 rounded-lg border p-4 transition ${
              hoveredStage === stage.id
                ? "border-[#0b8f84] bg-[#0b8f84]/5"
                : "border-slate-200 bg-slate-50"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-bold text-slate-900">{stage.name}</h3>
              <span className="text-sm text-slate-500">{stageCards.length}</span>
            </div>

            {stageCards.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">
                Aucune opportunité à cette étape.
              </p>
            ) : (
              stageCards.map((card) => (
                <article
                  key={card.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", card.id);
                    event.dataTransfer.effectAllowed = "move";
                    setDraggedId(card.id);
                  }}
                  onDragEnd={() => setDraggedId(null)}
                  className={`rounded-md border border-slate-200 bg-white p-3 shadow-sm ${
                    draggedId === card.id ? "opacity-50" : ""
                  }`}
                >
                  <Link
                    href={`/opportunites/${card.id}`}
                    className="font-semibold text-slate-950 underline-offset-4 hover:underline"
                  >
                    {card.contactName}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">
                    {card.contactEmail}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-800">
                    {card.valueLabel}
                    {card.probability !== undefined
                      ? ` — ${card.probability} %`
                      : ""}
                  </p>
                  {card.expectedCloseLabel ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Clôture estimée : {card.expectedCloseLabel}
                    </p>
                  ) : null}

                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs text-slate-500">Ordre</span>
                    {(["up", "down"] as const).map((direction) => (
                      <form key={direction} action={reorderOpportunityAction}>
                        <input
                          type="hidden"
                          name="opportunityId"
                          value={card.id}
                        />
                        <input
                          type="hidden"
                          name="direction"
                          value={direction}
                        />
                        <button
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-800"
                          aria-label={`${
                            direction === "up" ? "Monter" : "Descendre"
                          } ${card.contactName} dans cette colonne`}
                        >
                          {direction === "up" ? "↑" : "↓"}
                        </button>
                      </form>
                    ))}
                  </div>

                  <form
                    id={`move-${card.id}`}
                    action={moveOpportunityStageAction}
                    className="mt-3 flex flex-wrap items-center gap-2"
                  >
                    <input
                      type="hidden"
                      name="opportunityId"
                      value={card.id}
                    />
                    <label className="sr-only" htmlFor={`stage-${card.id}`}>
                      Déplacer {card.contactName} vers une autre étape
                    </label>
                    <select
                      id={`stage-${card.id}`}
                      name="stageId"
                      defaultValue={card.stageId}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      {stages.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                    <button className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-800">
                      Déplacer
                    </button>
                  </form>
                </article>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}
