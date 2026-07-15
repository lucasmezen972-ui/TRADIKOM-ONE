import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { ImportError } from "@/modules/imports/errors";
import type {
  ImportFormat,
  ImportMapping,
} from "@/modules/imports/schemas";

export const importFileSizeLimit = 5 * 1024 * 1024;
export const importRowLimit = 10_000;
const importColumnLimit = 100;
const importCellLengthLimit = 10_000;
const importJsonDepthLimit = 8;

export type ParsedImportFile = {
  headers: string[];
  rows: Array<Record<string, string>>;
  selectedSheet: string | null;
};

export async function parseImportFile(input: {
  buffer: Buffer;
  format: ImportFormat;
  contentType: string;
  sheetName?: string;
}): Promise<ParsedImportFile> {
  assertFileEnvelope(input);

  if (input.format === "csv") {
    return parseCsv(input.buffer);
  }
  if (input.format === "json") {
    return parseJson(input.buffer);
  }
  return parseXlsx(input.buffer, input.sheetName);
}

export function mapImportRow(
  row: Record<string, string>,
  mapping: ImportMapping,
) {
  return Object.fromEntries(
    Object.entries(mapping).map(([target, source]) => [
      target,
      row[normalizeHeader(source)]?.trim() ?? "",
    ]),
  );
}

export function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_.-]/g, "");
}

function assertFileEnvelope(input: {
  buffer: Buffer;
  format: ImportFormat;
  contentType: string;
}) {
  if (input.buffer.length === 0) {
    throw new ImportError("empty_file", "Le fichier est vide.");
  }
  if (input.buffer.length > importFileSizeLimit) {
    throw new ImportError(
      "file_too_large",
      "Le fichier dépasse la limite autorisée de 5 Mo.",
    );
  }

  const allowedContentTypes: Record<ImportFormat, readonly string[]> = {
    csv: ["text/csv", "text/plain", "application/csv"],
    json: ["application/json", "text/json", "text/plain"],
    xlsx: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream",
    ],
  };
  if (!allowedContentTypes[input.format].includes(input.contentType)) {
    throw new ImportError(
      "content_type_not_allowed",
      "Le type du fichier ne correspond pas au format sélectionné.",
    );
  }
  if (input.format === "xlsx" && input.buffer.subarray(0, 2).toString() !== "PK") {
    throw new ImportError(
      "invalid_xlsx_signature",
      "Le classeur XLSX n'est pas valide.",
    );
  }
}

function parseCsv(buffer: Buffer): ParsedImportFile {
  let records: Record<string, unknown>[];
  try {
    records = parse(buffer, {
      bom: true,
      columns: true,
      delimiter: detectDelimiter(buffer.toString("utf8")),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
      max_record_size: 64 * 1024,
      to_line: importRowLimit + 2,
    }) as Record<string, unknown>[];
  } catch {
    throw new ImportError(
      "malformed_csv",
      "Le fichier CSV est mal formé ou dépasse les limites autorisées.",
    );
  }
  return normalizeRecords(records, null);
}

function parseJson(buffer: Buffer): ParsedImportFile {
  let value: unknown;
  try {
    value = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new ImportError("malformed_json", "Le fichier JSON est mal formé.");
  }
  assertJsonDepth(value, 0);
  if (!Array.isArray(value) || value.some((row) => !isPlainObject(row))) {
    throw new ImportError(
      "invalid_json_shape",
      "Le JSON doit contenir une liste d'objets simples.",
    );
  }
  return normalizeRecords(value as Record<string, unknown>[], null);
}

async function parseXlsx(
  buffer: Buffer,
  requestedSheet?: string,
): Promise<ParsedImportFile> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new ImportError(
      "malformed_xlsx",
      "Le classeur XLSX est mal formé ou non pris en charge.",
    );
  }
  const worksheet = requestedSheet
    ? workbook.getWorksheet(requestedSheet)
    : workbook.worksheets[0];
  if (!worksheet) {
    throw new ImportError("sheet_not_found", "La feuille demandée est introuvable.");
  }
  if (worksheet.actualRowCount > importRowLimit + 1) {
    throw new ImportError(
      "too_many_rows",
      `Le fichier dépasse la limite de ${importRowLimit} lignes.`,
    );
  }

  const headerRow = worksheet.getRow(1);
  const rawHeaders: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, column) => {
    rawHeaders[column - 1] = cellToString(cell.value);
  });
  const records: Record<string, unknown>[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const record: Record<string, unknown> = {};
    rawHeaders.forEach((header, index) => {
      record[header] = cellToString(row.getCell(index + 1).value);
    });
    records.push(record);
  }
  return normalizeRecords(records, worksheet.name);
}

function normalizeRecords(
  records: Record<string, unknown>[],
  selectedSheet: string | null,
): ParsedImportFile {
  if (records.length > importRowLimit) {
    throw new ImportError(
      "too_many_rows",
      `Le fichier dépasse la limite de ${importRowLimit} lignes.`,
    );
  }
  const headers = Array.from(
    new Set(records.flatMap((row) => Object.keys(row).map(normalizeHeader))),
  ).filter(Boolean);
  if (headers.length === 0) {
    throw new ImportError("missing_headers", "Aucun en-tête exploitable n'a été trouvé.");
  }
  if (headers.length > importColumnLimit) {
    throw new ImportError(
      "too_many_columns",
      `Le fichier dépasse la limite de ${importColumnLimit} colonnes.`,
    );
  }

  const rows = records.map((record) =>
    Object.fromEntries(
      Object.entries(record).map(([key, value]) => {
        const cell = scalarToString(value);
        assertSafeCell(cell);
        return [normalizeHeader(key), cell];
      }),
    ),
  );
  return { headers, rows, selectedSheet };
}

function scalarToString(value: unknown) {
  if (value === null || value === undefined) return "";
  if (["string", "number", "boolean"].includes(typeof value)) {
    const result = String(value).replaceAll("\0", "").trim();
    if (result.length > importCellLengthLimit) {
      throw new ImportError(
        "cell_too_large",
        "Une cellule dépasse la taille autorisée.",
      );
    }
    return result;
  }
  throw new ImportError(
    "nested_value_not_allowed",
    "Les objets et listes imbriqués ne sont pas autorisés dans les lignes.",
  );
}

function cellToString(value: ExcelJS.CellValue) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      throw new ImportError(
        "spreadsheet_formula_not_allowed",
        "Les formules de tableur ne sont pas autorisées dans les imports.",
      );
    }
    if ("richText" in value) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value) return value.text;
    if ("error" in value) return value.error;
  }
  return scalarToString(value);
}

function assertSafeCell(value: string) {
  const trimmed = value.trimStart();
  const formulaLike =
    /^[=@]/.test(trimmed) || /^[+-](?!\d+(?:[.,]\d+)?$)/.test(trimmed);
  if (formulaLike) {
    throw new ImportError(
      "spreadsheet_formula_not_allowed",
      "Une valeur pouvant être interprétée comme une formule a été refusée.",
    );
  }
}

function assertJsonDepth(value: unknown, depth: number) {
  if (depth > importJsonDepthLimit) {
    throw new ImportError(
      "json_too_deep",
      `Le JSON dépasse la profondeur maximale de ${importJsonDepthLimit}.`,
    );
  }
  if (Array.isArray(value)) {
    value.forEach((item) => assertJsonDepth(item, depth + 1));
  } else if (isPlainObject(value)) {
    Object.values(value).forEach((item) => assertJsonDepth(item, depth + 1));
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/).find(Boolean) ?? "";
  const candidates = [",", ";", "\t"] as const;
  return candidates.reduce((best, candidate) =>
    firstLine.split(candidate).length > firstLine.split(best).length
      ? candidate
      : best,
  );
}
