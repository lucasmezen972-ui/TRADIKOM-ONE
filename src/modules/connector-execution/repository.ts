import type { DbClient } from "@/lib/db";
import { toJson } from "@/lib/security";
import type {
  ConnectorHealthState,
  ConnectorInstallationStatus,
} from "@/modules/connector-execution/schemas";

export type ConnectorInstallationRow = {
  id: string;
  tenant_id: string;
  software_connection_id: string;
  connector_key: string;
  connector_version: string;
  api_version: string;
  environment: "mock" | "sandbox" | "production";
  status: ConnectorInstallationStatus;
  approved_operations: string;
  required_scopes: string;
  rate_limit_limit: number | string;
  rate_limit_remaining: number | string;
  rate_limit_reset_at: string;
  security_suspended: number | boolean;
  breaking_change_blocked: number | boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ConnectorExecutionRow = {
  id: string;
  tenant_id: string;
  connector_installation_id: string;
  connector_version: string;
  environment: "mock" | "sandbox" | "production";
  operation: string;
  capability: "read" | "write";
  idempotency_key: string;
  correlation_id: string;
  started_at: string;
  completed_at: string | null;
  status: "running" | "succeeded" | "failed" | "denied" | "cancelled";
  safe_result_summary: string | null;
  safe_error_classification: string | null;
  retry_count: number | string;
  rate_limit_remaining: number | string | null;
  rate_limit_reset_at: string | null;
  created_at: string;
};

export type ConnectorHealthRow = {
  id: string;
  tenant_id: string;
  connector_installation_id: string;
  health_state: ConnectorHealthState;
  authentication_state: "valid" | "expired" | "revoked" | "unknown";
  last_successful_sync_at: string | null;
  last_failed_sync_at: string | null;
  latency_ms: number | string | null;
  rate_limit_remaining: number | string | null;
  rate_limit_reset_at: string | null;
  api_version: string;
  connector_version: string;
  webhook_state: string;
  schema_drift_state: string;
  breaking_change_state: string;
  retry_backlog: number | string;
  recommended_action: string;
  observed_at: string;
};

export type ConnectorExecutionContextRow = ConnectorInstallationRow & {
  connection_status: string;
  connection_scopes: string;
  credential_scopes: string | null;
  credential_expires_at: string | null;
  credential_revoked_at: string | null;
};

export async function findInstallationForConnection(
  db: DbClient,
  tenantId: string,
  connectionId: string,
) {
  const result = await db.query<ConnectorInstallationRow>(
    `select * from connector_installations
     where tenant_id = $1 and software_connection_id = $2
       and connector_key = 'mock_business'`,
    [tenantId, connectionId],
  );
  return result.rows[0] ?? null;
}

export async function insertMockInstallation(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    connectionId: string;
    createdBy: string;
    now: string;
    rateLimitResetAt: string;
  },
) {
  await db.query(
    `insert into connector_installations (
       id, tenant_id, software_connection_id, connector_key,
       connector_version, api_version, environment, status,
       approved_operations, required_scopes, rate_limit_limit,
       rate_limit_remaining, rate_limit_reset_at, security_suspended,
       breaking_change_blocked, created_by, created_at, updated_at
     ) values ($1, $2, $3, 'mock_business', '1.0.0', 'mock-v1', 'mock',
       'installed_disabled', $4, $5, 20, 20, $6, 0, 0, $7, $8, $8)`,
    [
      input.id,
      input.tenantId,
      input.connectionId,
      toJson(["contacts.list", "profile.read"]),
      toJson(["contacts.read", "profile.read"]),
      input.rateLimitResetAt,
      input.createdBy,
      input.now,
    ],
  );
}

export async function findConnectorExecutionContext(
  db: DbClient,
  tenantId: string,
  installationId: string,
) {
  const result = await db.query<ConnectorExecutionContextRow>(
    `select installation.*,
            connection.status as connection_status,
            connection.scopes as connection_scopes,
            credential.scopes as credential_scopes,
            credential.expires_at as credential_expires_at,
            credential.revoked_at as credential_revoked_at
     from connector_installations installation
     join software_connections connection
       on connection.tenant_id = installation.tenant_id
      and connection.id = installation.software_connection_id
     left join oauth_credentials credential
       on credential.tenant_id = installation.tenant_id
      and credential.software_connection_id = installation.software_connection_id
      and credential.revoked_at is null
     where installation.tenant_id = $1 and installation.id = $2`,
    [tenantId, installationId],
  );
  return result.rows[0] ?? null;
}

export async function updateInstallationStatus(
  db: DbClient,
  input: {
    tenantId: string;
    installationId: string;
    status: ConnectorInstallationStatus;
    now: string;
  },
) {
  await db.query(
    `update connector_installations set status = $1, updated_at = $2
     where tenant_id = $3 and id = $4`,
    [input.status, input.now, input.tenantId, input.installationId],
  );
}

export async function findExecutionByIdempotency(
  db: DbClient,
  input: { tenantId: string; installationId: string; idempotencyKey: string },
) {
  const result = await db.query<ConnectorExecutionRow>(
    `select * from connector_executions
     where tenant_id = $1 and connector_installation_id = $2
       and idempotency_key = $3`,
    [input.tenantId, input.installationId, input.idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function consumeInstallationRateLimit(
  db: DbClient,
  input: {
    tenantId: string;
    installationId: string;
    now: string;
    nextResetAt: string;
  },
) {
  const result = await db.query<{ rate_limit_remaining: number | string }>(
    `update connector_installations
     set rate_limit_remaining = case
           when rate_limit_reset_at <= $1 then rate_limit_limit - 1
           else rate_limit_remaining - 1
         end,
         rate_limit_reset_at = case
           when rate_limit_reset_at <= $1 then $2
           else rate_limit_reset_at
         end,
         updated_at = $1
     where tenant_id = $3 and id = $4
       and (
         (rate_limit_reset_at <= $1 and rate_limit_limit > 0)
         or rate_limit_remaining > 0
       )
     returning rate_limit_remaining`,
    [input.now, input.nextResetAt, input.tenantId, input.installationId],
  );
  return result.rows[0] ?? null;
}

export async function insertConnectorExecution(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    installationId: string;
    connectorVersion: string;
    environment: string;
    operation: string;
    capability: string;
    idempotencyKey: string;
    correlationId: string;
    startedAt: string;
    completedAt: string | null;
    status: ConnectorExecutionRow["status"];
    safeErrorClassification: string | null;
    rateLimitRemaining: number | null;
    rateLimitResetAt: string | null;
  },
) {
  const result = await db.query<{ id: string }>(
    `insert into connector_executions (
       id, tenant_id, connector_installation_id, connector_version,
       environment, operation, capability, idempotency_key, correlation_id,
       started_at, completed_at, status, safe_result_summary,
       safe_error_classification, retry_count, rate_limit_remaining,
       rate_limit_reset_at, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       null, $13, 0, $14, $15, $10)
     on conflict (tenant_id, connector_installation_id, idempotency_key)
       do nothing
     returning id`,
    [
      input.id,
      input.tenantId,
      input.installationId,
      input.connectorVersion,
      input.environment,
      input.operation,
      input.capability,
      input.idempotencyKey,
      input.correlationId,
      input.startedAt,
      input.completedAt,
      input.status,
      input.safeErrorClassification,
      input.rateLimitRemaining,
      input.rateLimitResetAt,
    ],
  );
  return result.rows[0] ?? null;
}

export async function completeConnectorExecution(
  db: DbClient,
  input: {
    tenantId: string;
    executionId: string;
    completedAt: string;
    status: "succeeded" | "failed" | "denied";
    safeResultSummary: string | null;
    safeErrorClassification: string | null;
    rateLimitRemaining: number;
    rateLimitResetAt: string;
  },
) {
  await db.query(
    `update connector_executions
     set completed_at = $1, status = $2, safe_result_summary = $3,
         safe_error_classification = $4, rate_limit_remaining = $5,
         rate_limit_reset_at = $6
     where tenant_id = $7 and id = $8 and status = 'running'`,
    [
      input.completedAt,
      input.status,
      input.safeResultSummary,
      input.safeErrorClassification,
      input.rateLimitRemaining,
      input.rateLimitResetAt,
      input.tenantId,
      input.executionId,
    ],
  );
}

export async function upsertConnectorHealth(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    installationId: string;
    healthState: ConnectorHealthState;
    authenticationState: "valid" | "expired" | "revoked" | "unknown";
    lastSuccessfulSyncAt: string | null;
    lastFailedSyncAt: string | null;
    latencyMs: number | null;
    rateLimitRemaining: number | null;
    rateLimitResetAt: string | null;
    apiVersion: string;
    connectorVersion: string;
    breakingChangeState: string;
    recommendedAction: string;
    observedAt: string;
  },
) {
  await db.query(
    `insert into connector_health_records (
       id, tenant_id, connector_installation_id, health_state,
       authentication_state, last_successful_sync_at, last_failed_sync_at,
       latency_ms, rate_limit_remaining, rate_limit_reset_at, api_version,
       connector_version, webhook_state, schema_drift_state,
       breaking_change_state, retry_backlog, recommended_action, observed_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       'not_configured', 'stable', $13, 0, $14, $15)
     on conflict (tenant_id, connector_installation_id) do update set
       health_state = excluded.health_state,
       authentication_state = excluded.authentication_state,
       last_successful_sync_at = coalesce(
         excluded.last_successful_sync_at,
         connector_health_records.last_successful_sync_at
       ),
       last_failed_sync_at = coalesce(
         excluded.last_failed_sync_at,
         connector_health_records.last_failed_sync_at
       ),
       latency_ms = excluded.latency_ms,
       rate_limit_remaining = excluded.rate_limit_remaining,
       rate_limit_reset_at = excluded.rate_limit_reset_at,
       api_version = excluded.api_version,
       connector_version = excluded.connector_version,
       breaking_change_state = excluded.breaking_change_state,
       recommended_action = excluded.recommended_action,
       observed_at = excluded.observed_at`,
    [
      input.id,
      input.tenantId,
      input.installationId,
      input.healthState,
      input.authenticationState,
      input.lastSuccessfulSyncAt,
      input.lastFailedSyncAt,
      input.latencyMs,
      input.rateLimitRemaining,
      input.rateLimitResetAt,
      input.apiVersion,
      input.connectorVersion,
      input.breakingChangeState,
      input.recommendedAction,
      input.observedAt,
    ],
  );
}

export async function listConnectorInstallations(db: DbClient, tenantId: string) {
  const result = await db.query<ConnectorInstallationRow>(
    `select * from connector_installations
     where tenant_id = $1 order by updated_at desc, id desc`,
    [tenantId],
  );
  return result.rows;
}

export async function listConnectorExecutions(db: DbClient, tenantId: string) {
  const result = await db.query<ConnectorExecutionRow>(
    `select * from connector_executions
     where tenant_id = $1 order by created_at desc, id desc`,
    [tenantId],
  );
  return result.rows;
}

export async function listConnectorHealth(db: DbClient, tenantId: string) {
  const result = await db.query<ConnectorHealthRow>(
    `select * from connector_health_records
     where tenant_id = $1 order by observed_at desc, id desc`,
    [tenantId],
  );
  return result.rows;
}

export async function disconnectInstallationsForSoftwareConnection(
  db: DbClient,
  input: { tenantId: string; connectionId: string; now: string },
) {
  await db.query(
    `update connector_installations set status = 'disconnected', updated_at = $1
     where tenant_id = $2 and software_connection_id = $3
       and status <> 'revoked'`,
    [input.now, input.tenantId, input.connectionId],
  );
  await db.query(
    `update connector_health_records
     set health_state = 'disconnected', authentication_state = 'revoked',
         recommended_action = 'Reconnecter le logiciel', observed_at = $1
     where tenant_id = $2 and connector_installation_id in (
       select id from connector_installations
       where tenant_id = $2 and software_connection_id = $3
     )`,
    [input.now, input.tenantId, input.connectionId],
  );
}
