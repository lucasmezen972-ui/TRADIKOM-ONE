import type { DbClient } from "@/lib/db";

export async function insertProvisionedPipeline(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    name: string;
    createdAt: string;
  },
) {
  await db.query(
    "insert into pipelines (id, tenant_id, name, created_at) values ($1, $2, $3, $4)",
    [input.id, input.tenantId, input.name, input.createdAt],
  );
}

export async function insertProvisionedPipelineStage(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    pipelineId: string;
    name: string;
    position: number;
  },
) {
  await db.query(
    "insert into pipeline_stages (id, tenant_id, pipeline_id, name, position) values ($1, $2, $3, $4, $5)",
    [
      input.id,
      input.tenantId,
      input.pipelineId,
      input.name,
      input.position,
    ],
  );
}

export async function insertProvisionedWorkflow(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    workflowKey: string;
    name: string;
    triggerName: string;
    status: string;
    approvalPolicy: string;
    definition: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into workflows (id, tenant_id, workflow_key, name, trigger_name, status, approval_policy, definition, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.id,
      input.tenantId,
      input.workflowKey,
      input.name,
      input.triggerName,
      input.status,
      input.approvalPolicy,
      input.definition,
      input.createdAt,
    ],
  );
}

export async function insertProvisionedConnector(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    connectorKey: string;
    status: string;
    health: string;
    safeConfig: string;
    lastSyncAt: string | null;
    createdAt: string;
  },
) {
  await db.query(
    `insert into connectors (id, tenant_id, connector_key, status, health, safe_config, last_sync_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.id,
      input.tenantId,
      input.connectorKey,
      input.status,
      input.health,
      input.safeConfig,
      input.lastSyncAt,
      input.createdAt,
      input.createdAt,
    ],
  );
}

export async function insertProvisionedWebhookEndpoint(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    token: string;
    status: string;
    createdAt: string;
  },
) {
  await db.query(
    "insert into webhook_endpoints (id, tenant_id, token, secret_hash, status, created_at) values ($1, $2, $3, $4, $5, $6)",
    [
      input.id,
      input.tenantId,
      input.token,
      null,
      input.status,
      input.createdAt,
    ],
  );
}
