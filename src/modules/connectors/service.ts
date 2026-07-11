import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { connectorCatalog } from "@/modules/connectors/catalog";
import { parseContactsCsv } from "@/modules/connectors/csv";
import { ConnectorError } from "@/modules/connectors/errors";
import {
  findImportedContactByEmail,
  findWebhookEndpointByToken,
  insertConnectorActivity,
  insertConnectorSyncRun,
  insertImportedContact,
  insertImportRow,
  insertImportRun,
  insertWebhookDelivery,
  listConnectorStates,
  updateConnectorSyncState,
  updateImportRun,
} from "@/modules/connectors/repository";
import {
  csvImportSchema,
  webhookPayloadSchema,
  webhookTokenSchema,
} from "@/modules/connectors/schemas";
import {
  verifyWebhookEndpointSignature,
  type WebhookSignatureInput,
} from "@/modules/connectors/webhooks";
import { createLeadFromPayload } from "@/modules/crm";
import { assertTenantAccess } from "@/modules/tenants";

export type { WebhookSignatureInput } from "@/modules/connectors/webhooks";

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
  await assertTenantAccess(db, userId, tenantId, ["owner", "administrator", "manager"]);
  const parsed = csvImportSchema.parse({ csvText });
  const rows = parseContactsCsv(parsed.csvText);
  const importId = id("import");
  const report = {
    total: rows.length,
    imported: 0,
    duplicates: 0,
    invalid: 0,
  };
  const now = nowIso();

  await insertImportRun(db, {
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
      await insertImportRow(db, {
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

    const duplicate = await findImportedContactByEmail(db, tenantId, email);
    if (duplicate) {
      report.duplicates += 1;
      await insertImportRow(db, {
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

    await insertImportedContact(db, {
      id: id("contact"),
      tenantId,
      name,
      email,
      phone,
      ownerId: userId,
      createdAt: nowIso(),
    });
    report.imported += 1;
    await insertImportRow(db, {
      tenantId,
      importId,
      rowId: id("importrow"),
      rowNumber: index + 2,
      status: "imported",
      data: row.raw,
      error: null,
    });
  }

  await updateImportRun(db, {
    tenantId,
    importId,
    status: "completed",
    report,
  });
  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "connector.csv_imported",
    targetType: "import",
    targetId: importId,
    metadata: report,
  });

  return report;
}

export async function syncMockConnector(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId, ["owner", "administrator", "manager"]);
  const now = nowIso();
  await updateConnectorSyncState(db, {
    tenantId,
    connectorKey: "mock_business",
    status: "Connecté",
    health: "healthy",
    updatedAt: now,
  });
  await insertConnectorSyncRun(db, {
    id: id("sync"),
    tenantId,
    connectorKey: "mock_business",
    status: "succeeded",
    summary: "3 clients, 2 rendez-vous et 1 devis simules synchronises.",
    createdAt: now,
  });
  await insertConnectorActivity(db, {
    id: id("activity"),
    tenantId,
    type: "connector.sync_completed",
    summary: "Synchronisation demo terminee.",
    targetType: "connector",
    targetId: "mock_business",
    createdAt: now,
  });
  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "connector.sync_completed",
    targetType: "connector",
    targetId: "mock_business",
    metadata: {},
  });
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
  if (!row || row.status !== "active") {
    throw new ConnectorError("webhook_invalid", "Webhook invalide.");
  }

  const signature = await verifyWebhookEndpointSignature(
    db,
    {
      id: row.id,
      tenantId: row.tenant_id,
      secretHash: row.secret_hash,
    },
    signatureInput,
  );

  if (!signature.ok) {
    await recordWebhookDelivery(db, row.tenant_id, row.id, parsedPayload, "rejected", signature.error);
    throw new ConnectorError("webhook_signature_invalid", signature.error);
  }

  const mapped = {
    name: String(parsedPayload.name ?? parsedPayload.nom ?? "Contact webhook"),
    email: String(parsedPayload.email ?? parsedPayload.mail ?? ""),
    phone: String(parsedPayload.phone ?? parsedPayload.telephone ?? ""),
    message: String(parsedPayload.message ?? parsedPayload.notes ?? "Demande recue par webhook"),
  };

  if (!mapped.email.includes("@")) {
    await recordWebhookDelivery(db, row.tenant_id, row.id, parsedPayload, "rejected", "Email invalide");
    throw new ConnectorError("webhook_payload_invalid", "Payload invalide.");
  }

  const result = await createLeadFromPayload(db, row.tenant_id, {
    ...mapped,
    source: "webhook",
    pagePath: "webhook/generic",
  });
  await recordWebhookDelivery(db, row.tenant_id, row.id, parsedPayload, "accepted", null);
  await recordAuditLog(db, {
    tenantId: row.tenant_id,
    actorId: "system",
    action: "connector.webhook_received",
    targetType: "lead",
    targetId: result.leadId,
    metadata: { endpointId: row.id },
  });

  return result;
}

async function recordWebhookDelivery(
  db: DbClient,
  tenantId: string,
  endpointId: string,
  payload: Record<string, unknown>,
  status: string,
  error: string | null,
) {
  await insertWebhookDelivery(db, {
    id: id("delivery"),
    tenantId,
    endpointId,
    payload,
    status,
    error,
    createdAt: nowIso(),
  });
}
