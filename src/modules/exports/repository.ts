import type { DbClient } from "@/lib/db";
import { safeJson, toJson } from "@/lib/security";
import type {
  ExportEntity,
  ExportFormat,
} from "@/modules/exports/schemas";

export type ExportJobRow = {
  id: string;
  tenant_id: string;
  entity_type: ExportEntity;
  format: ExportFormat;
  status: string;
  selected_fields: string;
  date_from: string;
  date_to: string;
  row_count: number;
  safe_content: string | null;
  content_encoding: string | null;
  content_type: string | null;
  file_name: string | null;
  safe_error_code: string | null;
  expires_at: string;
  downloaded_at: string | null;
  cancelled_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export async function insertExportJob(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    entityType: ExportEntity;
    format: ExportFormat;
    selectedFields: string[];
    dateFrom: string;
    dateTo: string;
    expiresAt: string;
    createdBy: string;
    now: string;
  },
) {
  await db.query(
    `insert into export_jobs (
       id, tenant_id, entity_type, format, status, selected_fields,
       date_from, date_to, row_count, safe_content, content_encoding,
       content_type, file_name, safe_error_code, expires_at, downloaded_at,
       cancelled_at, created_by, created_at, updated_at, completed_at
     ) values (
       $1, $2, $3, $4, 'queued', $5, $6, $7, 0, null, null,
       null, null, null, $8, null, null, $9, $10, $10, null
     )`,
    [
      input.id,
      input.tenantId,
      input.entityType,
      input.format,
      toJson(input.selectedFields),
      input.dateFrom,
      input.dateTo,
      input.expiresAt,
      input.createdBy,
      input.now,
    ],
  );
}

export async function findExportJob(
  db: DbClient,
  tenantId: string,
  exportId: string,
) {
  const result = await db.query<ExportJobRow>(
    "select * from export_jobs where tenant_id = $1 and id = $2",
    [tenantId, exportId],
  );
  return result.rows[0] ?? null;
}

export async function listExportJobs(db: DbClient, tenantId: string) {
  const result = await db.query<ExportJobRow>(
    `select * from export_jobs
      where tenant_id = $1
      order by created_at desc
      limit 25`,
    [tenantId],
  );
  return result.rows;
}

export async function markExportProcessing(
  db: DbClient,
  input: { tenantId: string; exportId: string; now: string },
) {
  await db.query(
    `update export_jobs set status = 'processing', updated_at = $1
      where tenant_id = $2 and id = $3 and status = 'queued'`,
    [input.now, input.tenantId, input.exportId],
  );
}

export async function completeExportJob(
  db: DbClient,
  input: {
    tenantId: string;
    exportId: string;
    rowCount: number;
    content: Buffer;
    contentType: string;
    fileName: string;
    now: string;
  },
) {
  await db.query(
    `update export_jobs
        set status = 'completed', row_count = $1, safe_content = $2,
            content_encoding = 'base64', content_type = $3, file_name = $4,
            safe_error_code = null, completed_at = $5, updated_at = $5
      where tenant_id = $6 and id = $7 and status = 'processing'`,
    [
      input.rowCount,
      input.content.toString("base64"),
      input.contentType,
      input.fileName,
      input.now,
      input.tenantId,
      input.exportId,
    ],
  );
}

export async function failExportJob(
  db: DbClient,
  input: { tenantId: string; exportId: string; errorCode: string; now: string },
) {
  await db.query(
    `update export_jobs
        set status = 'failed', safe_content = null, content_encoding = null,
            safe_error_code = $1, updated_at = $2
      where tenant_id = $3 and id = $4 and status in ('queued', 'processing')`,
    [input.errorCode, input.now, input.tenantId, input.exportId],
  );
}

export async function cancelExportJob(
  db: DbClient,
  input: { tenantId: string; exportId: string; now: string },
) {
  await db.query(
    `update export_jobs
        set status = 'cancelled', safe_content = null, content_encoding = null,
            cancelled_at = $1, updated_at = $1
      where tenant_id = $2 and id = $3
        and status in ('queued', 'processing', 'completed')`,
    [input.now, input.tenantId, input.exportId],
  );
}

export async function expireExportJob(
  db: DbClient,
  input: { tenantId: string; exportId: string; now: string },
) {
  await db.query(
    `update export_jobs
        set status = 'expired', safe_content = null, content_encoding = null,
            updated_at = $1
      where tenant_id = $2 and id = $3 and status = 'completed'`,
    [input.now, input.tenantId, input.exportId],
  );
}

export async function markExportDownloaded(
  db: DbClient,
  input: { tenantId: string; exportId: string; now: string },
) {
  await db.query(
    `update export_jobs set downloaded_at = $1, updated_at = $1
      where tenant_id = $2 and id = $3 and status = 'completed'`,
    [input.now, input.tenantId, input.exportId],
  );
}

export async function listExportSourceRows(
  db: DbClient,
  input: {
    tenantId: string;
    entityType: ExportEntity;
    dateFrom: string;
    dateTo: string;
    limit: number;
  },
): Promise<Array<Record<string, unknown>>> {
  const params = [input.tenantId, input.dateFrom, input.dateTo, input.limit];
  if (input.entityType === "contacts") {
    const result = await db.query<Record<string, unknown>>(
      `select name, email, phone, status, source, tags, created_at
         from contacts where tenant_id = $1 and created_at between $2 and $3
        order by created_at, id limit $4`,
      params,
    );
    return result.rows.map((row) => ({
      ...row,
      tags: safeJson<string[]>(String(row.tags ?? ""), []),
    }));
  }
  if (input.entityType === "companies") {
    return queryRows(
      db,
      `select name, domain, created_at
         from companies where tenant_id = $1 and created_at between $2 and $3
        order by created_at, id limit $4`,
      params,
    );
  }
  if (input.entityType === "opportunities") {
    return queryRows(
      db,
      `select contacts.email as contact_email, pipeline_stages.name as stage_name,
              opportunities.value_cents, opportunities.next_follow_up_at,
              opportunities.lost_reason, opportunities.created_at
         from opportunities
         join contacts on contacts.tenant_id = opportunities.tenant_id
          and contacts.id = opportunities.contact_id
         join pipeline_stages on pipeline_stages.tenant_id = opportunities.tenant_id
          and pipeline_stages.id = opportunities.stage_id
        where opportunities.tenant_id = $1
          and opportunities.created_at between $2 and $3
        order by opportunities.created_at, opportunities.id limit $4`,
      params,
    );
  }
  if (input.entityType === "tasks") {
    return queryRows(
      db,
      `select title, status, due_at, related_type, created_at
         from tasks where tenant_id = $1 and created_at between $2 and $3
        order by created_at, id limit $4`,
      params,
    );
  }
  if (input.entityType === "activities") {
    return queryRows(
      db,
      `select type, summary, target_type, created_at
         from activities where tenant_id = $1 and created_at between $2 and $3
        order by created_at, id limit $4`,
      params,
    );
  }
  if (input.entityType === "products") {
    const rows = await queryRows(
      db,
      `select name, sku, price_cents, active, created_at
         from products where tenant_id = $1 and created_at between $2 and $3
        order by created_at, id limit $4`,
      params,
    );
    return rows.map((row) => ({ ...row, active: Boolean(row.active) }));
  }
  if (input.entityType === "workflows") {
    return queryRows(
      db,
      `select name, trigger_name, status, approval_policy, created_at
         from workflows where tenant_id = $1 and created_at between $2 and $3
        order by created_at, id limit $4`,
      params,
    );
  }
  return queryRows(
    db,
    `select software_connections.software_name, software_connections.account_label,
            connector_installations.environment, connector_health_records.health_state,
            connector_health_records.authentication_state,
            connector_health_records.last_successful_sync_at,
            connector_health_records.last_failed_sync_at,
            connector_health_records.api_version,
            connector_health_records.connector_version,
            connector_health_records.recommended_action,
            connector_health_records.observed_at
       from connector_health_records
       join connector_installations
         on connector_installations.tenant_id = connector_health_records.tenant_id
        and connector_installations.id = connector_health_records.connector_installation_id
       join software_connections
         on software_connections.tenant_id = connector_installations.tenant_id
        and software_connections.id = connector_installations.software_connection_id
      where connector_health_records.tenant_id = $1
        and connector_health_records.observed_at between $2 and $3
      order by connector_health_records.observed_at, connector_health_records.id limit $4`,
    params,
  );
}

export function mapExportJob(row: ExportJobRow) {
  return {
    id: row.id,
    entityType: row.entity_type,
    format: row.format,
    status: row.status,
    selectedFields: safeJson<string[]>(row.selected_fields, []),
    dateFrom: row.date_from,
    dateTo: row.date_to,
    rowCount: Number(row.row_count),
    contentType: row.content_type,
    fileName: row.file_name,
    safeErrorCode: row.safe_error_code,
    expiresAt: row.expires_at,
    downloadedAt: row.downloaded_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

async function queryRows(
  db: DbClient,
  sql: string,
  params: unknown[],
): Promise<Array<Record<string, unknown>>> {
  return (await db.query<Record<string, unknown>>(sql, params)).rows;
}
