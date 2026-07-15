import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso, safeJson } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { syncMockConnectorJob } from "@/modules/connectors";
import { ConnectorExecutionError } from "@/modules/connector-execution/errors";
import { evaluateConnectorPolicy } from "@/modules/connector-execution/policy";
import {
  completeConnectorExecution,
  consumeInstallationRateLimit,
  findConnectorExecutionContext,
  findExecutionByIdempotency,
  findInstallationForConnection,
  insertConnectorExecution,
  insertMockInstallation,
  listConnectorExecutions,
  listConnectorHealth,
  listConnectorInstallations,
  updateInstallationStatus,
  upsertConnectorHealth,
  type ConnectorExecutionContextRow,
  type ConnectorExecutionRow,
} from "@/modules/connector-execution/repository";
import {
  connectorInstallationReferenceSchema,
  executeConnectorOperationSchema,
  prepareMockInstallationSchema,
  type ConnectorInstallationStatus,
  type ExecuteConnectorOperationInput,
} from "@/modules/connector-execution/schemas";
import { findSoftwareConnection } from "@/modules/software-connections/repository";
import { assertTenantAccess } from "@/modules/tenants";

const connectorAdminRoles = ["owner", "administrator"] as const;

export async function prepareMockConnectorInstallation(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { connectionId: string },
) {
  const parsed = prepareMockInstallationSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...connectorAdminRoles,
    ]);
    const connection = await findSoftwareConnection(
      transaction,
      tenantId,
      parsed.connectionId,
    );
    if (!connection) {
      throw new ConnectorExecutionError(
        "connection_not_found",
        "La connexion logicielle est introuvable.",
      );
    }
    if (
      connection.status !== "connected" ||
      connection.environment !== "mock" ||
      connection.provider_key !== "mock_oauth"
    ) {
      throw new ConnectorExecutionError(
        "connection_not_ready",
        "La connexion logicielle n'est pas prête.",
      );
    }
    const existing = await findInstallationForConnection(
      transaction,
      tenantId,
      connection.id,
    );
    if (existing) return mapInstallation(existing);
    const installationId = id("connector_installation");
    const now = nowIso();
    const resetAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
    await insertMockInstallation(transaction, {
      id: installationId,
      tenantId,
      connectionId: connection.id,
      createdBy: userId,
      now,
      rateLimitResetAt: resetAt,
    });
    await upsertConnectorHealth(transaction, {
      id: id("connector_health"),
      tenantId,
      installationId,
      healthState: "unknown",
      authenticationState: "valid",
      lastSuccessfulSyncAt: null,
      lastFailedSyncAt: null,
      latencyMs: null,
      rateLimitRemaining: 20,
      rateLimitResetAt: resetAt,
      apiVersion: "mock-v1",
      connectorVersion: "1.0.0",
      breakingChangeState: "clear",
      recommendedAction: "Activer la lecture seule",
      observedAt: now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "connector.installation_prepared",
      targetType: "connector_installation",
      targetId: installationId,
      metadata: {
        connectorKey: "mock_business",
        environment: "mock",
        status: "installed_disabled",
        productionWritesEnabled: false,
      },
    });
    const created = await findConnectorExecutionContext(
      transaction,
      tenantId,
      installationId,
    );
    if (!created) {
      throw new ConnectorExecutionError(
        "installation_not_found",
        "L'installation du connecteur est introuvable.",
      );
    }
    return mapInstallation(created);
  });
}

export async function enableMockConnectorReadOnly(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { installationId: string },
) {
  const parsed = connectorInstallationReferenceSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...connectorAdminRoles,
    ]);
    const installation = await findConnectorExecutionContext(
      transaction,
      tenantId,
      parsed.installationId,
    );
    if (!installation) throw installationNotFound();
    if (
      installation.status !== "installed_disabled" ||
      installation.connection_status !== "connected" ||
      !installation.credential_expires_at ||
      new Date(installation.credential_expires_at).getTime() <= Date.now()
    ) {
      throw new ConnectorExecutionError(
        "connection_not_ready",
        "Les accès du connecteur ne sont pas prêts.",
      );
    }
    const now = nowIso();
    await updateInstallationStatus(transaction, {
      tenantId,
      installationId: installation.id,
      status: "read_only_enabled",
      now,
    });
    await upsertConnectorHealth(transaction, {
      id: id("connector_health"),
      tenantId,
      installationId: installation.id,
      healthState: "unknown",
      authenticationState: "valid",
      lastSuccessfulSyncAt: null,
      lastFailedSyncAt: null,
      latencyMs: null,
      rateLimitRemaining: Number(installation.rate_limit_remaining),
      rateLimitResetAt: installation.rate_limit_reset_at,
      apiVersion: installation.api_version,
      connectorVersion: installation.connector_version,
      breakingChangeState: "clear",
      recommendedAction: "Lancer la première synchronisation",
      observedAt: now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "connector.read_only_enabled",
      targetType: "connector_installation",
      targetId: installation.id,
      metadata: {
        connectorKey: installation.connector_key,
        environment: installation.environment,
        approvedOperations: safeJson<string[]>(
          installation.approved_operations,
          [],
        ),
        productionWritesEnabled: false,
      },
    });
    return { installationId: installation.id, status: "read_only_enabled" as const };
  });
}

export async function executeMockConnectorOperation(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: ExecuteConnectorOperationInput,
) {
  const parsed = executeConnectorOperationSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...connectorAdminRoles,
    ]);
    const installation = await findConnectorExecutionContext(
      transaction,
      tenantId,
      parsed.installationId,
    );
    if (!installation) throw installationNotFound();
    const existing = await findExecutionByIdempotency(transaction, {
      tenantId,
      installationId: installation.id,
      idempotencyKey: parsed.idempotencyKey,
    });
    if (existing) return mapExecution(existing, true);

    const now = new Date();
    const startedAt = now.toISOString();
    const policy = evaluateConnectorPolicy({
      requestedTenantId: tenantId,
      tenantId: installation.tenant_id,
      status: installation.status,
      environment: installation.environment,
      requestedEnvironment: parsed.environment,
      operation: parsed.operation,
      capability: parsed.capability,
      approvedOperations: safeJson<string[]>(
        installation.approved_operations,
        [],
      ),
      requiredScopes: safeJson<string[]>(installation.required_scopes, []),
      credentialScopes: safeJson<string[]>(
        installation.credential_scopes,
        [],
      ),
      credentialExpiresAt: installation.credential_expires_at,
      credentialRevokedAt: installation.credential_revoked_at,
      connectorVersion: installation.connector_version,
      apiVersion: installation.api_version,
      securitySuspended: Boolean(installation.security_suspended),
      breakingChangeBlocked: Boolean(installation.breaking_change_blocked),
      now,
    });
    if (!policy.allowed) {
      return recordDeniedExecution(transaction, {
        userId,
        tenantId,
        installation,
        parsed,
        code: policy.code,
        startedAt,
      });
    }

    const executionId = id("connector_execution");
    const reserved = await insertConnectorExecution(transaction, {
      id: executionId,
      tenantId,
      installationId: installation.id,
      connectorVersion: installation.connector_version,
      environment: installation.environment,
      operation: parsed.operation,
      capability: parsed.capability,
      idempotencyKey: parsed.idempotencyKey,
      correlationId: parsed.correlationId,
      startedAt,
      completedAt: null,
      status: "running",
      safeErrorClassification: null,
      rateLimitRemaining: Number(installation.rate_limit_remaining),
      rateLimitResetAt: installation.rate_limit_reset_at,
    });
    if (!reserved) {
      const replay = await findExecutionByIdempotency(transaction, {
        tenantId,
        installationId: installation.id,
        idempotencyKey: parsed.idempotencyKey,
      });
      if (!replay) throw installationNotFound();
      return mapExecution(replay, true);
    }

    const resetAt = new Date(now.getTime() + 60 * 60 * 1_000).toISOString();
    const rateLimit = await consumeInstallationRateLimit(transaction, {
      tenantId,
      installationId: installation.id,
      now: startedAt,
      nextResetAt: resetAt,
    });
    if (!rateLimit) {
      return finalizeReservedDenial(transaction, {
        userId,
        tenantId,
        installation,
        parsed,
        executionId,
        code: "rate_limited",
        startedAt,
      });
    }

    const remaining = Number(rateLimit.rate_limit_remaining);
    const effectiveResetAt =
      installation.rate_limit_reset_at <= startedAt
        ? resetAt
        : installation.rate_limit_reset_at;

    try {
      await syncMockConnectorJob(transaction, { tenantId, actorId: userId });
      const completedAt = nowIso();
      await completeConnectorExecution(transaction, {
        tenantId,
        executionId,
        completedAt,
        status: "succeeded",
        safeResultSummary: "3 clients, 2 rendez-vous et 1 devis simulés lus.",
        safeErrorClassification: null,
        rateLimitRemaining: remaining,
        rateLimitResetAt: effectiveResetAt,
      });
      await upsertConnectorHealth(transaction, {
        id: id("connector_health"),
        tenantId,
        installationId: installation.id,
        healthState: "healthy",
        authenticationState: "valid",
        lastSuccessfulSyncAt: completedAt,
        lastFailedSyncAt: null,
        latencyMs: Math.max(0, Date.now() - now.getTime()),
        rateLimitRemaining: remaining,
        rateLimitResetAt: effectiveResetAt,
        apiVersion: installation.api_version,
        connectorVersion: installation.connector_version,
        breakingChangeState: "clear",
        recommendedAction: "Aucune action requise",
        observedAt: completedAt,
      });
      await recordAuditLog(transaction, {
        tenantId,
        actorId: userId,
        action: "connector.execution_succeeded",
        targetType: "connector_execution",
        targetId: executionId,
        metadata: {
          connectorInstallationId: installation.id,
          operation: parsed.operation,
          capability: parsed.capability,
          environment: parsed.environment,
          correlationId: parsed.correlationId,
          payloadStoredInAudit: false,
        },
      });
      const completed = await findExecutionByIdempotency(transaction, {
        tenantId,
        installationId: installation.id,
        idempotencyKey: parsed.idempotencyKey,
      });
      if (!completed) throw installationNotFound();
      return mapExecution(completed, false);
    } catch {
      const completedAt = nowIso();
      await completeConnectorExecution(transaction, {
        tenantId,
        executionId,
        completedAt,
        status: "failed",
        safeResultSummary: null,
        safeErrorClassification: "mock_execution_failed",
        rateLimitRemaining: remaining,
        rateLimitResetAt: effectiveResetAt,
      });
      await upsertConnectorHealth(transaction, {
        id: id("connector_health"),
        tenantId,
        installationId: installation.id,
        healthState: "degraded",
        authenticationState: "valid",
        lastSuccessfulSyncAt: null,
        lastFailedSyncAt: completedAt,
        latencyMs: null,
        rateLimitRemaining: remaining,
        rateLimitResetAt: effectiveResetAt,
        apiVersion: installation.api_version,
        connectorVersion: installation.connector_version,
        breakingChangeState: "clear",
        recommendedAction: "Relancer la synchronisation",
        observedAt: completedAt,
      });
      const failed = await findExecutionByIdempotency(transaction, {
        tenantId,
        installationId: installation.id,
        idempotencyKey: parsed.idempotencyKey,
      });
      if (!failed) throw installationNotFound();
      return mapExecution(failed, false);
    }
  });
}

export async function getConnectorExecutionWorkspace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  const role = await assertTenantAccess(db, userId, tenantId);
  const installations = await listConnectorInstallations(db, tenantId);
  const executions = await listConnectorExecutions(db, tenantId);
  const healthRecords = await listConnectorHealth(db, tenantId);
  return {
    canManage: connectorAdminRoles.includes(
      role as (typeof connectorAdminRoles)[number],
    ),
    installations: installations.map((installation) => {
      const latestExecution = executions.find(
        (execution) => execution.connector_installation_id === installation.id,
      );
      const health = healthRecords.find(
        (record) => record.connector_installation_id === installation.id,
      );
      return {
        ...mapInstallation(installation),
        health: health
          ? {
              state: health.health_state,
              authenticationState: health.authentication_state,
              lastSuccessfulSyncAt: health.last_successful_sync_at,
              lastFailedSyncAt: health.last_failed_sync_at,
              latencyMs:
                health.latency_ms === null ? null : Number(health.latency_ms),
              rateLimitRemaining:
                health.rate_limit_remaining === null
                  ? null
                  : Number(health.rate_limit_remaining),
              rateLimitResetAt: health.rate_limit_reset_at,
              apiVersion: health.api_version,
              connectorVersion: health.connector_version,
              webhookState: health.webhook_state,
              schemaDriftState: health.schema_drift_state,
              breakingChangeState: health.breaking_change_state,
              retryBacklog: Number(health.retry_backlog),
              recommendedAction: health.recommended_action,
              observedAt: health.observed_at,
            }
          : null,
        latestExecution: latestExecution
          ? mapExecution(latestExecution, false)
          : null,
      };
    }),
  };
}

async function recordDeniedExecution(
  db: DbClient,
  input: {
    userId: string;
    tenantId: string;
    installation: ConnectorExecutionContextRow;
    parsed: ReturnType<typeof executeConnectorOperationSchema.parse>;
    code: string;
    startedAt: string;
  },
) {
  const executionId = id("connector_execution");
  const inserted = await insertConnectorExecution(db, {
    id: executionId,
    tenantId: input.tenantId,
    installationId: input.installation.id,
    connectorVersion: input.installation.connector_version,
    environment: input.parsed.environment,
    operation: input.parsed.operation,
    capability: input.parsed.capability,
    idempotencyKey: input.parsed.idempotencyKey,
    correlationId: input.parsed.correlationId,
    startedAt: input.startedAt,
    completedAt: input.startedAt,
    status: "denied",
    safeErrorClassification: input.code,
    rateLimitRemaining: Number(input.installation.rate_limit_remaining),
    rateLimitResetAt: input.installation.rate_limit_reset_at,
  });
  if (!inserted) {
    const replay = await findExecutionByIdempotency(db, {
      tenantId: input.tenantId,
      installationId: input.installation.id,
      idempotencyKey: input.parsed.idempotencyKey,
    });
    if (!replay) throw installationNotFound();
    return mapExecution(replay, true);
  }
  await recordAuditLog(db, {
    tenantId: input.tenantId,
    actorId: input.userId,
    action: "connector.execution_denied",
    targetType: "connector_execution",
    targetId: executionId,
    metadata: {
      connectorInstallationId: input.installation.id,
      operation: input.parsed.operation,
      environment: input.parsed.environment,
      safeReason: input.code,
      payloadStoredInAudit: false,
    },
  });
  const isRateLimited = input.code === "rate_limited";
  const isAuthenticationFailure = input.code.startsWith("authentication_");
  await upsertConnectorHealth(db, {
    id: id("connector_health"),
    tenantId: input.tenantId,
    installationId: input.installation.id,
    healthState: isRateLimited
      ? "rate_limited"
      : isAuthenticationFailure
        ? "authentication_required"
        : "action_required",
    authenticationState: isAuthenticationFailure ? "expired" : "valid",
    lastSuccessfulSyncAt: null,
    lastFailedSyncAt: input.startedAt,
    latencyMs: null,
    rateLimitRemaining: Number(input.installation.rate_limit_remaining),
    rateLimitResetAt: input.installation.rate_limit_reset_at,
    apiVersion: input.installation.api_version,
    connectorVersion: input.installation.connector_version,
    breakingChangeState:
      input.code === "breaking_change_blocked" ? "blocked" : "clear",
    recommendedAction: isRateLimited
      ? "Attendre la réinitialisation du quota"
      : isAuthenticationFailure
        ? "Reconnecter le logiciel"
        : "Vérifier la politique du connecteur",
    observedAt: input.startedAt,
  });
  const denied = await findExecutionByIdempotency(db, {
    tenantId: input.tenantId,
    installationId: input.installation.id,
    idempotencyKey: input.parsed.idempotencyKey,
  });
  if (!denied) throw installationNotFound();
  return mapExecution(denied, false);
}

async function finalizeReservedDenial(
  db: DbClient,
  input: {
    userId: string;
    tenantId: string;
    installation: ConnectorExecutionContextRow;
    parsed: ReturnType<typeof executeConnectorOperationSchema.parse>;
    executionId: string;
    code: string;
    startedAt: string;
  },
) {
  await completeConnectorExecution(db, {
    tenantId: input.tenantId,
    executionId: input.executionId,
    completedAt: input.startedAt,
    status: "denied",
    safeResultSummary: null,
    safeErrorClassification: input.code,
    rateLimitRemaining: Number(input.installation.rate_limit_remaining),
    rateLimitResetAt: input.installation.rate_limit_reset_at,
  });
  await recordAuditLog(db, {
    tenantId: input.tenantId,
    actorId: input.userId,
    action: "connector.execution_denied",
    targetType: "connector_execution",
    targetId: input.executionId,
    metadata: {
      connectorInstallationId: input.installation.id,
      operation: input.parsed.operation,
      environment: input.parsed.environment,
      safeReason: input.code,
      payloadStoredInAudit: false,
    },
  });
  await upsertConnectorHealth(db, {
    id: id("connector_health"),
    tenantId: input.tenantId,
    installationId: input.installation.id,
    healthState: "rate_limited",
    authenticationState: "valid",
    lastSuccessfulSyncAt: null,
    lastFailedSyncAt: input.startedAt,
    latencyMs: null,
    rateLimitRemaining: 0,
    rateLimitResetAt: input.installation.rate_limit_reset_at,
    apiVersion: input.installation.api_version,
    connectorVersion: input.installation.connector_version,
    breakingChangeState: "clear",
    recommendedAction: "Attendre la réinitialisation du quota",
    observedAt: input.startedAt,
  });
  const denied = await findExecutionByIdempotency(db, {
    tenantId: input.tenantId,
    installationId: input.installation.id,
    idempotencyKey: input.parsed.idempotencyKey,
  });
  if (!denied) throw installationNotFound();
  return mapExecution(denied, false);
}

function mapInstallation(
  installation: {
    id: string;
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
  },
) {
  return {
    id: installation.id,
    connectionId: installation.software_connection_id,
    connectorKey: installation.connector_key,
    connectorVersion: installation.connector_version,
    apiVersion: installation.api_version,
    environment: installation.environment,
    status: installation.status,
    approvedOperations: safeJson<string[]>(installation.approved_operations, []),
    requiredScopes: safeJson<string[]>(installation.required_scopes, []),
    rateLimitLimit: Number(installation.rate_limit_limit),
    rateLimitRemaining: Number(installation.rate_limit_remaining),
    rateLimitResetAt: installation.rate_limit_reset_at,
  };
}

function mapExecution(execution: ConnectorExecutionRow, idempotentReplay: boolean) {
  return {
    id: execution.id,
    installationId: execution.connector_installation_id,
    operation: execution.operation,
    capability: execution.capability,
    environment: execution.environment,
    correlationId: execution.correlation_id,
    startedAt: execution.started_at,
    completedAt: execution.completed_at,
    status: execution.status,
    safeResultSummary: execution.safe_result_summary,
    safeErrorClassification: execution.safe_error_classification,
    retryCount: Number(execution.retry_count),
    rateLimitRemaining:
      execution.rate_limit_remaining === null
        ? null
        : Number(execution.rate_limit_remaining),
    rateLimitResetAt: execution.rate_limit_reset_at,
    idempotentReplay,
  };
}

function installationNotFound() {
  return new ConnectorExecutionError(
    "installation_not_found",
    "L'installation du connecteur est introuvable.",
  );
}
