import ExcelJS from "exceljs";
import { stringify } from "csv-stringify/sync";
import { ExportError } from "@/modules/exports/errors";
import {
  exportFieldDefinitions,
  type ExportEntity,
  type ExportFormat,
} from "@/modules/exports/schemas";

export const exportContentSizeLimit = 10 * 1024 * 1024;

export async function formatExport(input: {
  entityType: ExportEntity;
  format: ExportFormat;
  selectedFields: string[];
  rows: Array<Record<string, unknown>>;
}) {
  const labels = exportFieldDefinitions[input.entityType] as Record<string, string>;
  const normalizedRows = input.rows.map((row) =>
    Object.fromEntries(
      input.selectedFields.map((field) => [field, normalizeValue(row[field])]),
    ),
  );
  let content: Buffer;
  if (input.format === "json") {
    content = Buffer.from(JSON.stringify(normalizedRows, null, 2), "utf8");
  } else if (input.format === "csv") {
    content = Buffer.from(
      stringify(
        normalizedRows.map((row) =>
          input.selectedFields.map((field) => escapeSpreadsheetValue(row[field])),
        ),
        {
          bom: true,
          header: true,
          columns: input.selectedFields.map((field) => labels[field] ?? field),
        },
      ),
      "utf8",
    );
  } else {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TRADIKOM ONE";
    workbook.created = new Date(0);
    workbook.modified = new Date(0);
    const worksheet = workbook.addWorksheet("Données", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    worksheet.columns = input.selectedFields.map((field) => ({
      header: labels[field] ?? field,
      key: field,
      width: Math.min(40, Math.max(12, (labels[field] ?? field).length + 2)),
    }));
    normalizedRows.forEach((row) => {
      worksheet.addRow(
        Object.fromEntries(
          input.selectedFields.map((field) => [
            field,
            escapeSpreadsheetValue(row[field]),
          ]),
        ),
      );
    });
    worksheet.getRow(1).font = { bold: true };
    content = Buffer.from(await workbook.xlsx.writeBuffer());
  }
  if (content.length > exportContentSizeLimit) {
    throw new ExportError(
      "export_content_too_large",
      "L'export généré dépasse la limite autorisée de 10 Mo.",
    );
  }
  return {
    content,
    contentType: {
      csv: "text/csv; charset=utf-8",
      json: "application/json; charset=utf-8",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }[input.format],
  };
}

export function escapeSpreadsheetValue(value: unknown) {
  const text = normalizeValue(value);
  return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (Array.isArray(value)) return value.map(normalizeValue).join(", ");
  if (typeof value === "object") return "";
  return String(value).replaceAll("\0", "").slice(0, 10_000);
}
