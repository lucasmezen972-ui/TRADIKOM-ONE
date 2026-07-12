import { parse } from "csv-parse/sync";

export type CsvContactRow = {
  name: string;
  email: string;
  phone: string;
  raw: Record<string, string>;
};

export function parseContactsCsv(csvText: string): CsvContactRow[] {
  const delimiter = detectDelimiter(csvText);
  const records = parse(csvText, {
    bom: true,
    columns: true,
    delimiter,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  return records.map((record) => {
    const normalized = normalizeHeaders(record);
    return {
      name: normalized.nom ?? normalized.name ?? "",
      email: (normalized.email ?? normalized.mail ?? "").toLowerCase(),
      phone: normalized.telephone ?? normalized.phone ?? "",
      raw: normalized,
    };
  });
}

function detectDelimiter(csvText: string) {
  const firstLine = csvText.split(/\r?\n/).find(Boolean) ?? "";
  const comma = (firstLine.match(/,/g) ?? []).length;
  const semicolon = (firstLine.match(/;/g) ?? []).length;
  return semicolon > comma ? ";" : ",";
}

function normalizeHeaders(record: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim(),
      value,
    ]),
  );
}
