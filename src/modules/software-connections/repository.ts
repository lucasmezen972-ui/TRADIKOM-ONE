import type { DbClient } from "@/lib/db";
import { toJson } from "@/lib/security";
import type { SoftwareConnectionStatus } from "@/modules/software-connections/schemas";

export type SoftwareConnectionRow = {
  id: string;
  tenant_id: string;
  software_directory_id: string | null;
  software_key: string;
  software_name: string;
  provider_key: string;
  environment: "mock" | "sandbox" | "production";
  status: SoftwareConnectionStatus;
  account_label: string;
  scopes: string;
  created_by: string;
  connected_at: string | null;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
  credential_expires_at?: string | null;
  credential_key_version?: string | null;
};

export async function insertSoftwareConnection(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    softwareKey: string;
    softwareName: string;
    providerKey: string;
    environment: "mock" | "sandbox" | "production";
    status: SoftwareConnectionStatus;
    accountLabel: string;
    scopes: string[];
    createdBy: string;
    now: string;
  },
) {
  await db.query(
    `insert into software_connections (
       id, tenant_id, software_directory_id, software_key, software_name,
       provider_key, environment, status, account_label, scopes, created_by,
       connected_at, disconnected_at, created_at, updated_at
     ) values ($1, $2, null, $3, $4, $5, $6, $7, $8, $9, $10,
               null, null, $11, $11)`,
    [
      input.id,
      input.tenantId,
      input.softwareKey,
      input.softwareName,
      input.providerKey,
      input.environment,
      input.status,
      input.accountLabel,
      toJson(input.scopes),
      input.createdBy,
      input.now,
    ],
  );
}

export async function findSoftwareConnection(
  db: DbClient,
  tenantId: string,
  connectionId: string,
) {
  const result = await db.query<SoftwareConnectionRow>(
    "select * from software_connections where tenant_id = $1 and id = $2",
    [tenantId, connectionId],
  );
  return result.rows[0] ?? null;
}

export async function listSoftwareConnections(db: DbClient, tenantId: string) {
  const result = await db.query<SoftwareConnectionRow>(
    `select connection.*,
            credential.expires_at as credential_expires_at,
            credential.key_version as credential_key_version
     from software_connections connection
     left join oauth_credentials credential
       on credential.tenant_id = connection.tenant_id
      and credential.software_connection_id = connection.id
      and credential.revoked_at is null
     where connection.tenant_id = $1
     order by connection.updated_at desc, connection.id desc`,
    [tenantId],
  );
  return result.rows;
}

export async function markSoftwareConnectionConnected(
  db: DbClient,
  input: {
    tenantId: string;
    connectionId: string;
    scopes: string[];
    now: string;
  },
) {
  await db.query(
    `update software_connections
     set status = 'connected', scopes = $1, connected_at = $2,
         disconnected_at = null, updated_at = $2
     where tenant_id = $3 and id = $4`,
    [toJson(input.scopes), input.now, input.tenantId, input.connectionId],
  );
}

export async function markSoftwareConnectionDisconnected(
  db: DbClient,
  input: { tenantId: string; connectionId: string; now: string },
) {
  await db.query(
    `update software_connections
     set status = 'disconnected', disconnected_at = $1, updated_at = $1
     where tenant_id = $2 and id = $3`,
    [input.now, input.tenantId, input.connectionId],
  );
}
