import type { DbClient } from "@/lib/db";
import { safeJson, toJson } from "@/lib/security";
import type {
  ImportEntity,
  ImportFormat,
  ImportMapping,
} from "@/modules/imports/schemas";

export type ImportJobRow = {
  id: string;
  tenant_id: string;
  entity_type: ImportEntity;
  format: ImportFormat;
  file_name: string;
  content_type: string;
  file_size_bytes: number;
  status: string;
  report: string;
  mapping: string;
  headers: string;
  total_rows: number;
  processed_rows: number;
  created_by: string | null;
  validated_at: string | null;
  completed_at: string | null;
  rolled_back_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string | null;
};

export type ImportRowRecord = {
  id: string;
  tenant_id: string;
  import_id: string;
  row_number: number;
  status: string;
  safe_data: string;
  error: string | null;
  target_id: string | null;
  created_at: string | null;
};

export async function insertImportPreview(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    entityType: ImportEntity;
    format: ImportFormat;
    fileName: string;
    contentType: string;
    fileSizeBytes: number;
    mapping: ImportMapping;
    headers: string[];
    totalRows: number;
    report: Record<string, number>;
    createdBy: string;
    now: string;
  },
) {
  await db.query(
    `insert into imports (
       id, tenant_id, source, status, report, created_at,
       entity_type, format, file_name, content_type, file_size_bytes,
       mapping, headers, total_rows, processed_rows, created_by,
       validated_at, updated_at
     ) values (
       $1, $2, $3, 'validated', $4, $5,
       $6, $7, $8, $9, $10, $11, $12, $13, 0, $14, $15, $15
     )`,
    [
      input.id,
      input.tenantId,
      `universal_${input.format}_${input.entityType}`,
      toJson(input.report),
      input.now,
      input.entityType,
      input.format,
      input.fileName,
      input.contentType,
      input.fileSizeBytes,
      toJson(input.mapping),
      toJson(input.headers),
      input.totalRows,
      input.createdBy,
      input.now,
    ],
  );
}

export async function insertPreviewRow(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    importId: string;
    rowNumber: number;
    status: "valid" | "invalid" | "duplicate";
    safeData: Record<string, string>;
    error: string | null;
    now: string;
  },
) {
  await db.query(
    `insert into import_rows (
       id, tenant_id, import_id, row_number, status, safe_data, error, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.id,
      input.tenantId,
      input.importId,
      input.rowNumber,
      input.status,
      toJson(input.safeData),
      input.error,
      input.now,
    ],
  );
}

export async function findImportJob(
  db: DbClient,
  tenantId: string,
  importId: string,
) {
  const result = await db.query<ImportJobRow>(
    `select id, tenant_id, entity_type, format, file_name, content_type,
            file_size_bytes, status, report, mapping, headers, total_rows,
            processed_rows, created_by, validated_at, completed_at,
            rolled_back_at, cancelled_at, created_at, updated_at
       from imports
      where tenant_id = $1 and id = $2`,
    [tenantId, importId],
  );
  return result.rows[0] ?? null;
}

export async function listImportJobs(db: DbClient, tenantId: string) {
  const result = await db.query<ImportJobRow>(
    `select id, tenant_id, entity_type, format, file_name, content_type,
            file_size_bytes, status, report, mapping, headers, total_rows,
            processed_rows, created_by, validated_at, completed_at,
            rolled_back_at, cancelled_at, created_at, updated_at
       from imports
      where tenant_id = $1 and source like 'universal_%'
      order by created_at desc
      limit 25`,
    [tenantId],
  );
  return result.rows;
}

export async function listImportRows(
  db: DbClient,
  tenantId: string,
  importId: string,
  limit = 50,
) {
  const result = await db.query<ImportRowRecord>(
    `select id, tenant_id, import_id, row_number, status, safe_data,
            error, target_id, created_at
       from import_rows
      where tenant_id = $1 and import_id = $2
      order by row_number
      limit $3`,
    [tenantId, importId, limit],
  );
  return result.rows;
}

export async function listPendingImportRows(
  db: DbClient,
  tenantId: string,
  importId: string,
  limit: number,
) {
  const result = await db.query<ImportRowRecord>(
    `select id, tenant_id, import_id, row_number, status, safe_data,
            error, target_id, created_at
       from import_rows
      where tenant_id = $1 and import_id = $2 and status = 'valid'
      order by row_number
      limit $3`,
    [tenantId, importId, limit],
  );
  return result.rows;
}

export async function countPendingImportRows(
  db: DbClient,
  tenantId: string,
  importId: string,
) {
  const result = await db.query<{ count: number | string }>(
    `select count(*) as count
       from import_rows
      where tenant_id = $1 and import_id = $2 and status = 'valid'`,
    [tenantId, importId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function loadImportReferenceData(
  db: DbClient,
  tenantId: string,
) {
  const [contacts, companies, products, stages] = await Promise.all([
    db.query<{ email: string }>(
      "select email from contacts where tenant_id = $1",
      [tenantId],
    ),
    db.query<{ name: string; domain: string | null }>(
      "select name, domain from companies where tenant_id = $1",
      [tenantId],
    ),
    db.query<{ sku: string }>(
      "select sku from products where tenant_id = $1",
      [tenantId],
    ),
    db.query<{ name: string }>(
      "select name from pipeline_stages where tenant_id = $1",
      [tenantId],
    ),
  ]);
  return {
    contactEmails: new Set(contacts.rows.map((row) => row.email.toLowerCase())),
    companyNames: new Set(companies.rows.map((row) => row.name.toLowerCase())),
    companyDomains: new Set(
      companies.rows.flatMap((row) => row.domain ? [row.domain.toLowerCase()] : []),
    ),
    productSkus: new Set(products.rows.map((row) => row.sku.toLowerCase())),
    stageNames: new Set(stages.rows.map((row) => row.name.toLowerCase())),
  };
}

export async function insertImportTarget(
  db: DbClient,
  input: {
    tenantId: string;
    userId: string;
    entityType: ImportEntity;
    targetId: string;
    data: Record<string, string>;
    now: string;
  },
) {
  if (input.entityType === "contacts") {
    const result = await db.query<{ id: string }>(
      `insert into contacts (
         id, tenant_id, name, email, phone, status, source, tags,
         assigned_user_id, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, 'import', $7, $8, $9, $9)
       on conflict (tenant_id, email) do nothing
       returning id`,
      [
        input.targetId,
        input.tenantId,
        input.data.name,
        input.data.email,
        input.data.phone ?? "",
        input.data.status || "Importé",
        toJson(splitTags(input.data.tags)),
        input.userId,
        input.now,
      ],
    );
    return result.rows[0]?.id ?? null;
  }

  if (input.entityType === "companies") {
    const duplicate = await db.query<{ id: string }>(
      `select id from companies
        where tenant_id = $1
          and (lower(name) = lower($2) or ($3 <> '' and lower(coalesce(domain, '')) = lower($3)))
        limit 1`,
      [input.tenantId, input.data.name, input.data.domain ?? ""],
    );
    if (duplicate.rows[0]) return null;
    await db.query(
      `insert into companies (id, tenant_id, name, domain, created_at)
       values ($1, $2, $3, nullif($4, ''), $5)`,
      [
        input.targetId,
        input.tenantId,
        input.data.name,
        input.data.domain ?? "",
        input.now,
      ],
    );
    return input.targetId;
  }

  if (input.entityType === "products") {
    const result = await db.query<{ id: string }>(
      `insert into products (
         id, tenant_id, name, sku, price_cents, active, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, 1, $6, $6)
       on conflict (tenant_id, sku) do nothing
       returning id`,
      [
        input.targetId,
        input.tenantId,
        input.data.name,
        input.data.sku,
        Number(input.data.price_cents ?? 0),
        input.now,
      ],
    );
    return result.rows[0]?.id ?? null;
  }

  const references = await db.query<{ contact_id: string; stage_id: string }>(
    `select contacts.id as contact_id, pipeline_stages.id as stage_id
       from contacts
       join pipeline_stages on pipeline_stages.tenant_id = contacts.tenant_id
      where contacts.tenant_id = $1
        and lower(contacts.email) = lower($2)
        and lower(pipeline_stages.name) = lower($3)
      limit 1`,
    [input.tenantId, input.data.contact_email, input.data.stage_name],
  );
  const reference = references.rows[0];
  if (!reference) return null;
  await db.query(
    `insert into opportunities (
       id, tenant_id, contact_id, stage_id, value_cents,
       next_follow_up_at, lost_reason, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, null, null, $6, $6)`,
    [
      input.targetId,
      input.tenantId,
      reference.contact_id,
      reference.stage_id,
      Number(input.data.value_cents),
      input.now,
    ],
  );
  return input.targetId;
}

export async function markImportRowCommitted(
  db: DbClient,
  input: {
    tenantId: string;
    importId: string;
    rowId: string;
    status: "imported" | "duplicate";
    targetId: string | null;
  },
) {
  await db.query(
    `update import_rows
        set status = $1, target_id = $2,
            error = case when $1 = 'duplicate' then 'Doublon détecté lors de la finalisation' else error end
      where tenant_id = $3 and import_id = $4 and id = $5 and status = 'valid'`,
    [
      input.status,
      input.targetId,
      input.tenantId,
      input.importId,
      input.rowId,
    ],
  );
}

export async function updateImportAfterBatch(
  db: DbClient,
  input: {
    tenantId: string;
    importId: string;
    status: "processing" | "completed";
    processedRows: number;
    report: Record<string, number>;
    now: string;
  },
) {
  await db.query(
    `update imports
        set status = $1, processed_rows = $2, report = $3, updated_at = $4,
            completed_at = case when $1 = 'completed' then $4 else completed_at end
      where tenant_id = $5 and id = $6`,
    [
      input.status,
      input.processedRows,
      toJson(input.report),
      input.now,
      input.tenantId,
      input.importId,
    ],
  );
}

export async function listCommittedImportTargets(
  db: DbClient,
  tenantId: string,
  importId: string,
) {
  const result = await db.query<{ id: string; target_id: string }>(
    `select id, target_id
       from import_rows
      where tenant_id = $1 and import_id = $2
        and status = 'imported' and target_id is not null
      order by row_number desc`,
    [tenantId, importId],
  );
  return result.rows;
}

export async function deleteImportTarget(
  db: DbClient,
  tenantId: string,
  entityType: ImportEntity,
  targetId: string,
) {
  const table = {
    contacts: "contacts",
    companies: "companies",
    products: "products",
    opportunities: "opportunities",
  }[entityType];
  const result = await db.query(
    `delete from ${table} where tenant_id = $1 and id = $2`,
    [tenantId, targetId],
  );
  return (result.affectedRows ?? 0) > 0;
}

export async function markImportRolledBack(
  db: DbClient,
  input: { tenantId: string; importId: string; now: string },
) {
  await db.query(
    `update import_rows
        set status = 'rolled_back'
      where tenant_id = $1 and import_id = $2 and status = 'imported'`,
    [input.tenantId, input.importId],
  );
  await db.query(
    `update imports
        set status = 'rolled_back', rolled_back_at = $1, updated_at = $1
      where tenant_id = $2 and id = $3`,
    [input.now, input.tenantId, input.importId],
  );
}

export function mapImportJob(row: ImportJobRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    entityType: row.entity_type,
    format: row.format,
    fileName: row.file_name,
    contentType: row.content_type,
    fileSizeBytes: Number(row.file_size_bytes),
    status: row.status,
    report: safeJson<Record<string, number>>(row.report, {}),
    mapping: safeJson<ImportMapping>(row.mapping, {}),
    headers: safeJson<string[]>(row.headers, []),
    totalRows: Number(row.total_rows),
    processedRows: Number(row.processed_rows),
    validatedAt: row.validated_at,
    completedAt: row.completed_at,
    rolledBackAt: row.rolled_back_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapImportRowRecord(row: ImportRowRecord) {
  return {
    id: row.id,
    rowNumber: Number(row.row_number),
    status: row.status,
    data: safeJson<Record<string, string>>(row.safe_data, {}),
    error: row.error,
    targetId: row.target_id,
  };
}

function splitTags(value = "") {
  return value
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}
