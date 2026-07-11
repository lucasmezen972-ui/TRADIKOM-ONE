import type { DbClient } from "@/lib/db";
import { toJson } from "@/lib/security";
import type { ConnectorCard } from "@/lib/types";

export async function listConnectorStates(db: DbClient, tenantId: string) {
  const rows = await db.query<{
    connector_key: string;
    status: ConnectorCard["status"];
    health: ConnectorCard["health"];
    last_sync_at: string | null;
  }>("select connector_key, status, health, last_sync_at from connectors where tenant_id = $1", [
    tenantId,
  ]);

  return rows.rows;
}

export async function insertImportRun(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    source: string;
    status: string;
    report: Record<string, number>;
    createdAt: string;
  },
) {
  await db.query(
    "insert into imports (id, tenant_id, source, status, report, created_at) values ($1, $2, $3, $4, $5, $6)",
    [
      input.id,
      input.tenantId,
      input.source,
      input.status,
      toJson(input.report),
      input.createdAt,
    ],
  );
}

export async function updateImportRun(
  db: DbClient,
  input: {
    tenantId: string;
    importId: string;
    status: string;
    report: Record<string, number>;
  },
) {
  await db.query("update imports set status = $1, report = $2 where tenant_id = $3 and id = $4", [
    input.status,
    toJson(input.report),
    input.tenantId,
    input.importId,
  ]);
}

export async function insertImportRow(
  db: DbClient,
  input: {
    tenantId: string;
    importId: string;
    rowId: string;
    rowNumber: number;
    status: string;
    data: Record<string, string>;
    error: string | null;
  },
) {
  await db.query(
    "insert into import_rows (id, tenant_id, import_id, row_number, status, safe_data, error) values ($1, $2, $3, $4, $5, $6, $7)",
    [
      input.rowId,
      input.tenantId,
      input.importId,
      input.rowNumber,
      input.status,
      toJson(input.data),
      input.error,
    ],
  );
}

export async function findImportedContactByEmail(
  db: DbClient,
  tenantId: string,
  email: string,
) {
  const duplicate = await db.query<{ id: string }>(
    "select id from contacts where tenant_id = $1 and email = $2",
    [tenantId, email],
  );

  return duplicate.rows[0] ?? null;
}

export async function insertImportedContact(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    name: string;
    email: string;
    phone: string;
    ownerId: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into contacts (id, tenant_id, name, email, phone, status, source, tags, assigned_user_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.id,
      input.tenantId,
      input.name,
      input.email,
      input.phone,
      "Importe",
      "csv",
      toJson(["csv"]),
      input.ownerId,
      input.createdAt,
      input.createdAt,
    ],
  );
}

export async function updateConnectorSyncState(
  db: DbClient,
  input: {
    tenantId: string;
    connectorKey: string;
    status: ConnectorCard["status"];
    health: ConnectorCard["health"];
    updatedAt: string;
  },
) {
  await db.query(
    "update connectors set status = $1, health = $2, last_sync_at = $3, updated_at = $4 where tenant_id = $5 and connector_key = $6",
    [
      input.status,
      input.health,
      input.updatedAt,
      input.updatedAt,
      input.tenantId,
      input.connectorKey,
    ],
  );
}

export async function insertConnectorSyncRun(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    connectorKey: string;
    status: string;
    summary: string;
    createdAt: string;
  },
) {
  await db.query(
    "insert into connector_sync_runs (id, tenant_id, connector_key, status, summary, created_at) values ($1, $2, $3, $4, $5, $6)",
    [
      input.id,
      input.tenantId,
      input.connectorKey,
      input.status,
      input.summary,
      input.createdAt,
    ],
  );
}

export async function insertConnectorActivity(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    type: string;
    summary: string;
    targetType: string;
    targetId: string;
    createdAt: string;
  },
) {
  await db.query(
    "insert into activities (id, tenant_id, type, summary, target_type, target_id, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [
      input.id,
      input.tenantId,
      input.type,
      input.summary,
      input.targetType,
      input.targetId,
      input.createdAt,
    ],
  );
}

export async function findWebhookEndpointByToken(db: DbClient, token: string) {
  const endpoint = await db.query<{
    id: string;
    tenant_id: string;
    secret_hash: string | null;
    status: string;
  }>("select * from webhook_endpoints where token = $1", [token]);

  return endpoint.rows[0] ?? null;
}

export async function insertWebhookDelivery(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    endpointId: string;
    payload: Record<string, unknown>;
    status: string;
    error: string | null;
    createdAt: string;
  },
) {
  await db.query(
    "insert into webhook_deliveries (id, tenant_id, webhook_endpoint_id, status, payload, error, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [
      input.id,
      input.tenantId,
      input.endpointId,
      input.status,
      toJson(input.payload),
      input.error,
      input.createdAt,
    ],
  );
}
