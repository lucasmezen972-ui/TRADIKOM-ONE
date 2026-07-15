"use client";

import { FileOutput } from "lucide-react";
import { useState } from "react";
import { createUniversalExportAction } from "@/app/actions";
import {
  exportFieldDefinitions,
  type ExportEntity,
} from "@/modules/exports/schemas";

const entityLabels: Record<ExportEntity, string> = {
  contacts: "Contacts",
  companies: "Entreprises",
  opportunities: "Opportunités",
  tasks: "Tâches",
  activities: "Activités",
  products: "Produits",
  workflows: "Automatisations",
  connector_health: "Santé des connecteurs",
};

export function UniversalExportForm({
  defaultDateFrom,
  defaultDateTo,
}: {
  defaultDateFrom: string;
  defaultDateTo: string;
}) {
  const [entityType, setEntityType] = useState<ExportEntity>("contacts");
  const [selectedFields, setSelectedFields] = useState<string[]>(
    Object.keys(exportFieldDefinitions.contacts),
  );
  const fields = exportFieldDefinitions[entityType] as Record<string, string>;

  function selectEntity(next: ExportEntity) {
    setEntityType(next);
    setSelectedFields(Object.keys(exportFieldDefinitions[next]));
  }

  function toggleField(field: string) {
    setSelectedFields((current) =>
      current.includes(field)
        ? current.filter((item) => item !== field)
        : [...current, field],
    );
  }

  return (
    <form action={createUniversalExportAction} className="grid gap-5 border-y border-slate-200 py-6">
      <div className="grid gap-4 md:grid-cols-4">
        <label className="grid gap-1 text-sm font-semibold" htmlFor="export-entity">
          Type de données
          <select
            id="export-entity"
            name="entityType"
            value={entityType}
            onChange={(event) => selectEntity(event.target.value as ExportEntity)}
            className="min-h-11 rounded-md border border-slate-300 bg-white px-3 font-normal"
          >
            {Object.entries(entityLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="export-format">
          Format
          <select
            id="export-format"
            name="format"
            defaultValue="csv"
            className="min-h-11 rounded-md border border-slate-300 bg-white px-3 font-normal"
          >
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
            <option value="json">JSON</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="export-from">
          Du
          <input
            id="export-from"
            name="dateFrom"
            type="date"
            required
            defaultValue={defaultDateFrom}
            className="min-h-11 rounded-md border border-slate-300 bg-white px-3 font-normal"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="export-to">
          Au
          <input
            id="export-to"
            name="dateTo"
            type="date"
            required
            defaultValue={defaultDateTo}
            className="min-h-11 rounded-md border border-slate-300 bg-white px-3 font-normal"
          />
        </label>
      </div>

      <fieldset className="grid gap-3">
        <legend className="text-sm font-bold">Champs inclus</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(fields).map(([field, label]) => (
            <label key={field} className="flex min-h-10 items-center gap-3 rounded-md border border-slate-200 bg-white px-3 text-sm">
              <input
                type="checkbox"
                name="selectedFields"
                value={field}
                checked={selectedFields.includes(field)}
                onChange={() => toggleField(field)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Période maximale : 366 jours. Les fichiers expirent après 24 heures.
        </p>
        <button
          disabled={selectedFields.length === 0}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <FileOutput size={17} aria-hidden />
          Préparer l’export
        </button>
      </div>
    </form>
  );
}
