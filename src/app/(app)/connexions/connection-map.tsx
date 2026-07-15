"use client";

import {
  ArrowDownToLine,
  ArrowRight,
  Bot,
  Cable,
  CheckCheck,
  ExternalLink,
  Globe2,
  Mail,
  Network,
  Server,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import type {
  ConnectionMapEdge,
  ConnectionMapNode,
  ConnectionValueSummary,
} from "@/modules/connection-map";

const statusLabels: Record<ConnectionMapNode["status"], string> = {
  healthy: "Sain",
  active: "Actif",
  pending: "En attente",
  degraded: "Action requise",
  disconnected: "Déconnecté",
  unknown: "Non configuré",
};

const environmentLabels: Record<ConnectionMapNode["environment"], string> = {
  internal: "Interne",
  mock: "Test local",
  sandbox: "Sandbox",
  production: "Production",
  manual: "Manuel",
};

const directionLabels: Record<ConnectionMapEdge["direction"], string> = {
  inbound: "Entrant",
  outbound: "Sortant",
  internal: "Interne",
};

const subscribeToHydration = () => () => undefined;

export function ConnectionMap({
  nodes,
  edges,
  valueSummaries,
}: {
  nodes: ConnectionMapNode[];
  edges: ConnectionMapEdge[];
  valueSummaries: ConnectionValueSummary[];
}) {
  const [selectedId, setSelectedId] = useState("platform");
  const interactive = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const selected = nodes.find((node) => node.id === selectedId) ?? nodes[0];

  return (
    <section className="grid gap-5 border-y border-slate-200 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Flux contrôlés
          </p>
          <h2 className="mt-1 text-2xl font-bold">Carte des connexions</h2>
        </div>
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600">
          <Network size={17} aria-hidden />
          {nodes.length} éléments bornés
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div
          role="group"
          aria-label="Éléments de la carte des connexions"
          className="grid auto-rows-fr gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              disabled={!interactive}
              aria-pressed={selected?.id === node.id}
              onClick={() => setSelectedId(node.id)}
              className={`grid min-h-24 grid-cols-[36px_minmax(0,1fr)] items-start gap-3 rounded-lg border p-3 text-left transition disabled:cursor-wait ${
                selected?.id === node.id
                  ? "border-[#0f766e] bg-[#f0fdfa]"
                  : "border-slate-200 bg-white hover:border-slate-400"
              }`}
            >
              <span className="grid size-9 place-items-center rounded-md bg-slate-100 text-slate-700">
                <NodeIcon kind={node.kind} />
              </span>
              <span className="min-w-0">
                <span className="block break-words text-sm font-bold text-slate-950">
                  {node.label}
                </span>
                <span className="mt-1 block text-xs text-slate-600">
                  {statusLabels[node.status]} ·{" "}
                  {environmentLabels[node.environment]}
                </span>
              </span>
            </button>
          ))}
        </div>

        {selected ? (
          <aside className="grid content-start gap-4 border-y border-slate-200 py-4">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                {statusLabels[selected.status]} ·{" "}
                {environmentLabels[selected.environment]}
              </p>
              <h3 className="mt-1 text-lg font-bold">{selected.label}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {selected.detail}
              </p>
            </div>
            <Link
              href={selected.actionHref}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <ExternalLink size={16} aria-hidden />
              Ouvrir
            </Link>
          </aside>
        ) : null}
      </div>

      <div className="overflow-x-auto border-y border-slate-200">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">Source</th>
              <th className="px-3 py-3">Flux</th>
              <th className="px-3 py-3">Destination</th>
              <th className="px-3 py-3">État</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {edges.map((edge) => (
              <tr key={edge.id}>
                <td className="px-3 py-3 font-semibold">
                  {nodeLabel(nodes, edge.from)}
                </td>
                <td className="px-3 py-3 text-slate-600">
                  <span className="inline-flex items-center gap-2">
                    {edge.direction === "inbound" ? (
                      <ArrowDownToLine size={15} aria-hidden />
                    ) : (
                      <ArrowRight size={15} aria-hidden />
                    )}
                    {edge.label} · {directionLabels[edge.direction]}
                  </span>
                </td>
                <td className="px-3 py-3 font-semibold">
                  {nodeLabel(nodes, edge.to)}
                </td>
                <td className="px-3 py-3 text-slate-600">
                  {statusLabels[edge.status]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="border-y border-slate-200 py-3">
        <summary className="cursor-pointer text-sm font-semibold">
          Version textuelle accessible
        </summary>
        <ul className="mt-3 grid gap-2 text-sm text-slate-600">
          {edges.map((edge) => (
            <li key={`text-${edge.id}`}>
              {nodeLabel(nodes, edge.from)} vers {nodeLabel(nodes, edge.to)} :{" "}
              {edge.label}, {statusLabels[edge.status].toLowerCase()}.
            </li>
          ))}
        </ul>
      </details>

      {valueSummaries.length > 0 ? (
        <div className="grid gap-4">
          <h3 className="text-lg font-bold">Valeur opérationnelle estimée</h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {valueSummaries.map((summary) => (
              <article
                key={summary.id}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h4 className="font-bold">{summary.title}</h4>
                  <span className="text-xs font-semibold text-slate-600">
                    Effort {summary.setupEffort}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  Gain de temps : non mesuré faute de volume et de durée de référence.
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  Tâches manuelles potentiellement réduites :{" "}
                  {summary.likelyManualTasksReduced.length > 0
                    ? summary.likelyManualTasksReduced.join(", ")
                    : "non démontré"}
                  .
                </p>
                <ul className="mt-3 grid gap-1 text-sm text-slate-600">
                  {summary.possibleAutomations.length > 0 ? (
                    summary.possibleAutomations.map((item) => (
                      <li key={item}>{item}</li>
                    ))
                  ) : (
                    <li>Aucune automatisation active démontrée.</li>
                  )}
                </ul>
                <p className="mt-3 text-sm text-slate-600">
                  Réduction de risque : {summary.riskReduction.join(", ")}.
                </p>
                <p className="mt-3 text-xs font-semibold text-slate-500">
                  Confiance :{" "}
                  {summary.confidence === "fixture_locale"
                    ? "fixture locale"
                    : summary.confidence === "preuve_sandbox"
                      ? "preuve sandbox"
                      : "preuve production"}
                </p>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function nodeLabel(nodes: ConnectionMapNode[], id: string) {
  return nodes.find((node) => node.id === id)?.label ?? "Élément indisponible";
}

function NodeIcon({ kind }: { kind: ConnectionMapNode["kind"] }) {
  if (kind === "domain") return <Globe2 size={18} aria-hidden />;
  if (kind === "website") return <Server size={18} aria-hidden />;
  if (kind === "email") return <Mail size={18} aria-hidden />;
  if (kind === "software") return <Cable size={18} aria-hidden />;
  if (kind === "connector") return <Network size={18} aria-hidden />;
  if (kind === "workflow") return <Workflow size={18} aria-hidden />;
  if (kind === "approval") return <CheckCheck size={18} aria-hidden />;
  return <Bot size={18} aria-hidden />;
}
