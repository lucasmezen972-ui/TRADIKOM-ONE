import type { DbClient } from "@/lib/db";
import { withTenantDbTransaction } from "@/db/tenant-context";
import { id, nowIso, safeJson } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { connectorCatalog } from "@/modules/connectors/catalog";
import { parseContactsCsv } from "@/modules/connectors/csv";
import { ConnectorError } from "@/modules/connectors/errors";
import {
  findAcceptedWebhookDeliveryByIdempotencyKey,
  findImportedContactByEmail,
  findWebhookEndpointByToken,
  findWebhookEndpointForTenant,
  insertConnectorActivity,
  insertConnectorSyncRun,
  insertImportedContact,
  insertImportRow,
  insertImportRun,
  insertWebhookDelivery,
  listWebhookDeliveriesForEndpoint,
  listConnectorStates,
  updateConnectorSyncState,
  updateWebhookEndpointStatus,
  updateImportRun,
} from "@/modules/connectors/repository";
import {
  csvImportSchema,
  webhookEndpointStatusSchema,
  webhookGeneratedSecretRotationSchema,
  webhookIdempotencyKeySchema,
  webhookPayloadSchema,
  webhookSecretRotationSchema,
  webhookTokenSchema,
  type WebhookEndpointStatusInput,
  type WebhookGeneratedSecretRotationInput,
  type WebhookSecretRotationInput,
} from "@/modules/connectors/schemas";
import {
  configureWebhookEndpointSecret,
  ensureWebhookEndpointSecret,
  generateWebhookEndpointSecretValue,
  verifyWebhookEndpointSignature,
  type WebhookSignatureInput,
} from "@/modules/connectors/webhooks";
import { createLeadFromPayload } from "@/modules/crm";
import { assertTenantAccess } from "@/modules/tenants";
import {
  createDatabaseRateLimiter,
  rateLimitPolicies,
} from "@/modules/rate-limit";

export type { WebhookSignatureInput } from "@/modules/connectors/webhooks";

const webhookMaxPayloadBytes = 64 * 1024;
const connectorAdminRoles = ["owner", "administrator", "manager"] as const;

export async function getConnectors(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const states = await listConnectorStates(db, tenantId);
  const byKey = new Map(states.map((row) => [row.connector_key, row]));

  return connectorCatalog.map((connector) => {
    const state = byKey.get(connector.key);
    return state
      ? {
          ...connector,
          status: state.status,
          health: state.health,
          lastSyncAt: state.last_sync_at ?? undefined,
        }
      : connector;
  });
}

export async function importCsvContacts(
  db: DbClient,
  userId: string,
  tenantId: string,
  csvText: string,
) {
  const parsed = csvImportSchema.parse({ csvText });
  const rows = parseContactsCsv(parsed.csvText);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      "owner",
      "administrator",
      "manager",
    ]);
    const importId = id("import");
    const report = {
      total: rows.length,
      imported: 0,
      duplicates: 0,
      invalid: 0,
    };
    const now = nowIso();

    await insertImportRun(transaction, {
      id: importId,
      tenantId,
      source: "csv_contacts",
      status: "running",
      report,
      createdAt: now,
    });

    for (const [index, row] of rows.entries()) {
      const name = row.name;
      const email = row.email;
      const phone = row.phone;

      if (!name || !email.includes("@")) {
        report.invalid += 1;
        await insertImportRow(transaction, {
          tenantId,
          importId,
          rowId: id("importrow"),
          rowNumber: index + 2,
          status: "invalid",
          data: row.raw,
          error: "Email invalide",
        });
        continue;
      }

      const duplicate = await findImportedContactByEmail(
        transaction,
        tenantId,
        email,
      );
      if (duplicate) {
        report.duplicates += 1;
        await insertImportRow(transaction, {
          tenantId,
          importId,
          rowId: id("importrow"),
          rowNumber: index + 2,
          status: "duplicate",
          data: row.raw,
          error: null,
        });
        continue;
      }

      await insertImportedContact(transaction, {
        id: id("contact"),
        tenantId,
        name,
        email,
        phone,
        ownerId: userId,
        createdAt: nowIso(),
      });
      report.imported += 1;
      await insertImportRow(transaction, {
        tenantId,
        importId,
        rowId: id("importrow"),
        rowNumber: index + 2,
        status: "imported",
        data: row.raw,
        error: null,
      });
    }

    await updateImportRun(transaction, {
      tenantId,
      importId,
      status: "completed",
      report,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "connector.csv_imported",
      targetType: "import",
      targetId: importId,
      metadata: report,
    });

    return report;
  });
}

export async function syncMockConnectorJob(
  db: DbClient,
  input: {
    tenantId: string;
    actorId: string;
  },
) {
  const now = nowIso();
  await updateConnectorSyncState(db, {
    tenantId: input.tenantId,
    connectorKey: "mock_business",
    status: "Connecté",
    health: "healthy",
    updatedAt: now,
  });
  await insertConnectorSyncRun(db, {
    id: id("sync"),
    tenantId: input.tenantId,
    connectorKey: "mock_business",
    status: "succeeded",
    summary: "3 clients, 2 rendez-vous et 1 devis simules synchronises.",
    createdAt: now,
  });
  await insertConnectorActivity(db, {
    id: id("activity"),
    tenantId: input.tenantId,
    type: "connector.sync_completed",
    summary: "Synchronisation demo terminee.",
    targetType: "connector",
    targetId: "mock_business",
    createdAt: now,
  });
  await recordAuditLog(db, {
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: "connector.sync_completed",
    targetType: "connector",
    targetId: "mock_business",
    metadata: {},
  });
}

export async function getWebhookEndpointConfig(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const endpoint = await requireTenantWebhookEndpoint(db, tenantId);
  const secured = await ensureWebhookEndpointSecret(db, {
    id: endpoint.id,
    tenantId: endpoint.tenant_id,
    secretHash: endpoint.secret_hash,
  });
  const recentDeliveries = await listWebhookDeliveriesForEndpoint(db, {
    tenantId,
    endpointId: endpoint.id,
    limit: 10,
  });

  return {
    id: endpoint.id,
    url: `/api/webhooks/${endpoint.token}`,
    status: endpoint.status as "active" | "disabled",
    hasSecret: Boolean(secured.secretHash),
    createdAt: endpoint.created_at,
    recentDeliveries: recentDeliveries.map((delivery) => {
      const payload = safeJson<Record<string, unknown>>(delivery.payload, {});

      return {
        id: delivery.id,
        status: delivery.status as "accepted" | "rejected",
        idempotencyKey: delivery.idempotency_key,
        error: delivery.error,
        createdAt: delivery.created_at,
        payloadKeys: Object.keys(payload).slice(0, 6),
      };
    }),
  };
}

export async function rotateWebhookEndpointSecret(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: WebhookSecretRotationInput,
) {
  await assertTenantAccess(db, userId, tenantId, [...connectorAdminRoles]);
  const parsed = webhookSecretRotationSchema.parse(input);
  const endpoint = await requireTenantWebhookEndpoint(db, tenantId);

  if (endpoint.id !== parsed.endpointId) {
    throw new ConnectorError("webhook_invalid", "Webhook invalide.");
  }

  await configureWebhookEndpointSecret(db, {
    tenantId,
    endpointId: parsed.endpointId,
    secret: parsed.secret,
  });
  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "connector.webhook_secret_rotated",
    targetType: "webhook_endpoint",
    targetId: parsed.endpointId,
    metadata: { hasSecret: true },
  });

  return { endpointId: parsed.endpointId };
}

export async function generateWebhookEndpointSecretRotation(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: WebhookGeneratedSecretRotationInput,
) {
  const parsed = webhookGeneratedSecretRotationSchema.parse(input);
  const secret = generateWebhookEndpointSecretValue();
  const result = await rotateWebhookEndpointSecret(db, userId, tenantId, {
    endpointId: parsed.endpointId,
    secret,
  });

  return { ...result, secret };
}

export async function setWebhookEndpointStatus(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: WebhookEndpointStatusInput,
) {
  await assertTenantAccess(db, userId, tenantId, [...connectorAdminRoles]);
  const parsed = webhookEndpointStatusSchema.parse(input);
  const endpoint = await requireTenantWebhookEndpoint(db, tenantId);

  if (endpoint.id !== parsed.endpointId) {
    throw new ConnectorError("webhook_invalid", "Webhook invalide.");
  }

  const updated = await updateWebhookEndpointStatus(db, {
    tenantId,
    endpointId: parsed.endpointId,
    status: parsed.status,
  });

  if (!updated) {
    throw new ConnectorError("webhook_invalid", "Webhook invalide.");
  }

  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action:
      parsed.status === "active"
        ? "connector.webhook_enabled"
        : "connector.webhook_disabled",
    targetType: "webhook_endpoint",
    targetId: parsed.endpointId,
    metadata: { status: parsed.status },
  });

  return { endpointId: parsed.endpointId, status: parsed.status };
}

export async function receiveWebhook(
  db: DbClient,
  token: string,
  payload: Record<string, unknown>,
  signatureInput?: WebhookSignatureInput,
) {
  const parsedToken = webhookTokenSchema.parse({ token });
  const parsedPayload = webhookPayloadSchema.parse(payload);
  const row = await findWebhookEndpointByToken(db, parsedToken.token);
  if (!row) {
    throw new ConnectorError("webhook_invalid", "Webhook invalide.");
  }
  const idempotencyKey = parseWebhookIdempotencyKey(
    signatureInput?.idempotencyKey,
  );

  if (row.status !== "active") {
    await recordWebhookDelivery(
      db,
      row.tenant_id,
      row.id,
      idempotencyKey,
      parsedPayload,
      "rejected",
      "Webhook desactive.",
    );
    throw new ConnectorError("webhook_disabled", "Webhook desactive.");
  }

  const securedEndpoint = await ensureWebhookEndpointSecret(db, {
    id: row.id,
    tenantId: row.tenant_id,
    secretHash: row.secret_hash,
  });

  if (!idempotencyKey) {
    await recordWebhookDelivery(
      db,
      row.tenant_id,
      row.id,
      null,
      parsedPayload,
      "rejected",
      "Cle idempotence webhook manquante.",
    );
    throw new ConnectorError(
      "webhook_idempotency_missing",
      "Cle idempotence webhook manquante.",
    );
  }

  if (webhookPayloadSize(parsedPayload, signatureInput?.body) > webhookMaxPayloadBytes) {
    await recordWebhookDelivery(
      db,
      row.tenant_id,
      row.id,
      idempotencyKey,
      parsedPayload,
      "rejected",
      "Payload webhook trop volumineux.",
    );
    throw new ConnectorError(
      "webhook_oversized",
      "Payload webhook trop volumineux.",
    );
  }

  const rateLimit = await createDatabaseRateLimiter(db).consume({
    operationKey: "webhook.receive",
    subjectKey: row.id,
    scopeKey: row.tenant_id,
    limit: rateLimitPolicies.inboundWebhook.limit,
    windowSeconds: rateLimitPolicies.inboundWebhook.windowSeconds,
  });

  if (!rateLimit.allowed) {
    await recordWebhookDelivery(
      db,
      row.tenant_id,
      row.id,
      idempotencyKey,
      parsedPayload,
      "rejected",
      "Trop de requetes webhook.",
    );
    throw new ConnectorError(
      "webhook_rate_limited",
      "Trop de requetes webhook.",
      rateLimit.retryAfterSeconds,
    );
  }

  const signature = await verifyWebhookEndpointSignature(
    db,
    {
      id: row.id,
      tenantId: row.tenant_id,
      secretHash: securedEndpoint.secretHash,
    },
    signatureInput,
  );

  if (!signature.ok) {
    await recordWebhookDelivery(
      db,
      row.tenant_id,
      row.id,
      idempotencyKey,
      parsedPayload,
      "rejected",
      signature.error,
    );
    throw new ConnectorError("webhook_signature_invalid", signature.error);
  }

  const duplicate = await findAcceptedWebhookDeliveryByIdempotencyKey(db, {
    endpointId: row.id,
    idempotencyKey,
  });

  if (duplicate) {
    await recordWebhookDelivery(
      db,
      row.tenant_id,
      row.id,
      idempotencyKey,
      parsedPayload,
      "rejected",
      "Livraison webhook deja recue.",
    );
    throw new ConnectorError("webhook_duplicate", "Livraison webhook deja recue.");
  }

  const mapped = {
    name: String(parsedPayload.name ?? parsedPayload.nom ?? "Contact webhook"),
    email: String(parsedPayload.email ?? parsedPayload.mail ?? ""),
    phone: String(parsedPayload.phone ?? parsedPayload.telephone ?? ""),
    message: String(parsedPayload.message ?? parsedPayload.notes ?? "Demande recue par webhook"),
  };

  if (!mapped.email.includes("@")) {
    await recordWebhookDelivery(
      db,
      row.tenant_id,
      row.id,
      idempotencyKey,
      parsedPayload,
      "rejected",
      "Email invalide",
    );
    throw new ConnectorError("webhook_payload_invalid", "Payload invalide.");
  }

  return withTenantDbTransaction(
    db,
    row.tenant_id,
    "system",
    async (transaction) => {
      const result = await createLeadFromPayload(transaction, row.tenant_id, {
        ...mapped,
        source: "webhook",
        pagePath: "webhook/generic",
      });
      await recordWebhookDelivery(
        transaction,
        row.tenant_id,
        row.id,
        idempotencyKey,
        parsedPayload,
        "accepted",
        null,
      );
      await recordAuditLog(transaction, {
        tenantId: row.tenant_id,
        actorId: "system",
        action: "connector.webhook_received",
        targetType: "lead",
        targetId: result.leadId,
        metadata: { endpointId: row.id },
      });

      return result;
    },
  );
}

async function recordWebhookDelivery(
  db: DbClient,
  tenantId: string,
  endpointId: string,
  idempotencyKey: string | null,
  payload: Record<string, unknown>,
  status: string,
  error: string | null,
) {
  await insertWebhookDelivery(db, {
    id: id("delivery"),
    tenantId,
    endpointId,
    idempotencyKey,
    payload: sanitizeWebhookPayload(payload),
    status,
    error,
    createdAt: nowIso(),
  });
}

function parseWebhookIdempotencyKey(value: string | null | undefined) {
  const parsed = webhookIdempotencyKeySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function webhookPayloadSize(
  payload: Record<string, unknown>,
  rawBody: string | undefined,
) {
  return Buffer.byteLength(rawBody ?? JSON.stringify(payload), "utf8");
}

function sanitizeWebhookPayload(payload: Record<string, unknown>) {
  const entries = Object.entries(payload).slice(0, 50);
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of entries) {
    sanitized[key] = sensitiveWebhookKey(key)
      ? "[redacted]"
      : sanitizeWebhookValue(value);
  }

  if (Object.keys(payload).length > entries.length) {
    sanitized._truncatedKeys = Object.keys(payload).length - entries.length;
  }

  return sanitized;
}

function sanitizeWebhookValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}...[truncated]` : value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return `[array:${value.length}]`;
  }

  if (typeof value === "object") {
    return "[object]";
  }

  return String(value);
}

function sensitiveWebhookKey(key: string) {
  return /authorization|password|secret|token|api[_-]?key/i.test(key);
}

async function requireTenantWebhookEndpoint(db: DbClient, tenantId: string) {
  const endpoint = await findWebhookEndpointForTenant(db, tenantId);

  if (!endpoint) {
    throw new ConnectorError("webhook_invalid", "Webhook invalide.");
  }

  return endpoint;
}
