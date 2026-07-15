"use client";

import { FileUp } from "lucide-react";
import { useState } from "react";
import { previewUniversalImportAction } from "@/app/actions";

const configurations = {
  contacts: {
    label: "Contacts",
    fields: [
      ["name", "Nom", "nom"],
      ["email", "E-mail", "email"],
      ["phone", "Téléphone", "telephone"],
      ["status", "Statut", "statut"],
      ["tags", "Étiquettes", "etiquettes"],
    ],
  },
  companies: {
    label: "Entreprises",
    fields: [
      ["name", "Nom", "nom"],
      ["domain", "Domaine", "domaine"],
    ],
  },
  products: {
    label: "Produits",
    fields: [
      ["name", "Nom", "nom"],
      ["sku", "Référence", "reference"],
      ["price", "Prix", "prix"],
    ],
  },
  opportunities: {
    label: "Opportunités",
    fields: [
      ["contact_email", "E-mail du contact", "email_contact"],
      ["stage_name", "Étape du pipeline", "etape"],
      ["value", "Valeur", "valeur"],
    ],
  },
} as const;

type EntityType = keyof typeof configurations;

export function UniversalImportForm() {
  const [entityType, setEntityType] = useState<EntityType>("contacts");
  const [format, setFormat] = useState("csv");
  const configuration = configurations[entityType];

  return (
    <form
      action={previewUniversalImportAction}
      className="grid gap-5 border-y border-slate-200 py-6"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <label className="grid gap-1 text-sm font-semibold" htmlFor="import-entity">
          Type de données
          <select
            id="import-entity"
            name="entityType"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value as EntityType)}
            className="min-h-11 rounded-md border border-slate-300 bg-white px-3 font-normal"
          >
            {Object.entries(configurations).map(([key, value]) => (
              <option key={key} value={key}>{value.label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="import-format">
          Format
          <select
            id="import-format"
            name="format"
            value={format}
            onChange={(event) => setFormat(event.target.value)}
            className="min-h-11 rounded-md border border-slate-300 bg-white px-3 font-normal"
          >
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
            <option value="json">JSON</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="import-file">
          Fichier
          <input
            id="import-file"
            name="file"
            type="file"
            required
            accept={format === "xlsx" ? ".xlsx" : format === "json" ? ".json" : ".csv,text/csv"}
            className="min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 font-normal"
          />
        </label>
      </div>

      {format === "xlsx" ? (
        <label className="grid max-w-md gap-1 text-sm font-semibold" htmlFor="sheet-name">
          Feuille précise, facultatif
          <input
            id="sheet-name"
            name="sheetName"
            placeholder="La première feuille sera utilisée"
            className="min-h-11 rounded-md border border-slate-300 bg-white px-3 font-normal"
          />
        </label>
      ) : null}

      <fieldset className="grid gap-3">
        <legend className="text-sm font-bold">Correspondance des colonnes</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {configuration.fields.map(([key, label, example], index) => (
            <label key={key} className="grid gap-1 text-sm font-semibold" htmlFor={`mapping-${key}`}>
              {label}{index < (entityType === "contacts" || entityType === "companies" ? 1 : configuration.fields.length) ? " *" : ""}
              <input
                id={`mapping-${key}`}
                name={`mapping_${key}`}
                required={
                  entityType === "contacts"
                    ? ["name", "email"].includes(key)
                    : entityType === "companies"
                      ? key === "name"
                      : true
                }
                defaultValue={example}
                key={`${entityType}-${key}`}
                className="min-h-10 rounded-md border border-slate-300 bg-white px-3 font-normal"
              />
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Limite : 5 Mo, 10 000 lignes. Les formules et structures imbriquées sont refusées.
        </p>
        <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
          <FileUp size={17} aria-hidden />
          Valider l’aperçu
        </button>
      </div>
    </form>
  );
}
