import { afterEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  generateWebhookEndpointSecretRotation,
  getConnectors,
  getWebhookEndpointConfig,
  importCsvContacts,
  normalizeConnectorError,
  receiveWebhook,
  rotateWebhookEndpointSecret,
  setWebhookEndpointStatus,
  syncMockConnectorJob,
} from "../src/modules/connectors";
import { getCrm } from "../src/modules/crm";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { db, services: createServices(db) };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("connectors module", () => {
  it("does not expose raw connector failures", () => {
    const normalized = normalizeConnectorError(
      new Error("Authorization: Bearer must-not-be-logged"),
    );

    expect(normalized).toEqual({
      code: "connector_error",
      message: "Erreur connecteur",
      retryable: false,
    });
  });

  it("imports contacts, syncs the mock connector, and receives webhook leads", async () => {
    const { db, services } = await setup();
    const demo = await services.seedDemo();

    const report = await importCsvContacts(
      db,
      demo.user.id,
      demo.tenant.id,
      "nom,email,telephone\nModule Contact,module-contact@example.com,+596 696 55 66 77",
    );
    expect(report.imported).toBe(1);

    await syncMockConnectorJob(db, {
      tenantId: demo.tenant.id,
      actorId: demo.user.id,
    });
    const connectors = await getConnectors(db, demo.user.id, demo.tenant.id);
    expect(
      connectors.find((connector) => connector.key === "mock_business")?.health,
    ).toBe("healthy");

    const endpoint = await db.query<{ id: string; token: string }>(
      "select id, token from webhook_endpoints where tenant_id = $1 limit 1",
      [demo.tenant.id],
    );
    const rotation = await generateWebhookEndpointSecretRotation(
      db,
      demo.user.id,
      demo.tenant.id,
      { endpointId: endpoint.rows[0]!.id },
    );
    const payload = {
      name: "Module Webhook",
      email: "module-webhook@example.com",
      phone: "+596 696 10 11 12",
      message: "Demande module",
    };
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    await receiveWebhook(db, endpoint.rows[0]!.token, payload, {
      body,
      timestamp,
      signature: signWebhookBody(rotation.secret, timestamp, body),
      idempotencyKey: "module-webhook",
    });

    const crm = await getCrm(db, demo.user.id, demo.tenant.id);
    expect(
      crm.contacts.some((contact) => contact.email === "module-contact@example.com"),
    ).toBe(true);
    expect(
      crm.contacts.some((contact) => contact.email === "module-webhook@example.com"),
    ).toBe(true);
  });

  it("manages webhook endpoint configuration with tenant isolation", async () => {
    const { db, services } = await setup();
    const demo = await services.seedDemo();
    const other = await services.registerUser({
      name: "Autre utilisateur",
      email: "other-webhook@example.com",
      password: "password123",
    });
    const otherTenant = await services.createTenant(other.id, {
      name: "Autre tenant",
      category: "Garage",
    });
    const config = await getWebhookEndpointConfig(
      db,
      demo.user.id,
      demo.tenant.id,
    );
    const secret = "whsec_module_rotation";

    expect(config.status).toBe("active");
    expect(config.hasSecret).toBe(true);
    expect(config.recentDeliveries).toHaveLength(0);
    await expect(
      getWebhookEndpointConfig(db, other.id, demo.tenant.id),
    ).rejects.toThrow("Acces refuse");
    await expect(
      rotateWebhookEndpointSecret(db, other.id, demo.tenant.id, {
        endpointId: config.id,
        secret,
      }),
    ).rejects.toThrow("Acces refuse");
    await expect(
      setWebhookEndpointStatus(db, other.id, otherTenant.id, {
        endpointId: config.id,
        status: "disabled",
      }),
    ).rejects.toThrow("Webhook invalide.");

    const generated = await generateWebhookEndpointSecretRotation(
      db,
      demo.user.id,
      demo.tenant.id,
      { endpointId: config.id },
    );
    const secured = await getWebhookEndpointConfig(
      db,
      demo.user.id,
      demo.tenant.id,
    );
    expect(secured.hasSecret).toBe(true);
    expect(generated.secret).toMatch(/^whsec_[A-Za-z0-9_-]+$/);

    await setWebhookEndpointStatus(db, demo.user.id, demo.tenant.id, {
      endpointId: config.id,
      status: "disabled",
    });
    await expect(
      receiveWebhook(
        db,
        config.url.replace("/api/webhooks/", ""),
        { email: "disabled-webhook@example.com" },
        {
          body: "{\"email\":\"disabled-webhook@example.com\"}",
          idempotencyKey: "disabled-webhook",
        },
      ),
    ).rejects.toThrow("Webhook desactive.");
    const disabledDelivery = await db.query<{
      status: string;
      idempotency_key: string | null;
      error: string | null;
    }>(
      "select status, idempotency_key, error from webhook_deliveries where tenant_id = $1 order by created_at desc limit 1",
      [demo.tenant.id],
    );
    expect(disabledDelivery.rows[0]).toMatchObject({
      status: "rejected",
      idempotency_key: "disabled-webhook",
      error: "Webhook desactive.",
    });

    await setWebhookEndpointStatus(db, demo.user.id, demo.tenant.id, {
      endpointId: config.id,
      status: "active",
    });
    const reenabled = await getWebhookEndpointConfig(
      db,
      demo.user.id,
      demo.tenant.id,
    );
    expect(reenabled.status).toBe("active");
    expect(reenabled.recentDeliveries[0]).toMatchObject({
      status: "rejected",
      idempotencyKey: "disabled-webhook",
      error: "Webhook desactive.",
    });
    expect(reenabled.recentDeliveries[0]?.payloadKeys).toContain("email");
    expect(await countWebhookConfigAudits(db, demo.tenant.id)).toBe(3);
  });
});

async function countWebhookConfigAudits(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  tenantId: string,
) {
  const result = await db.query<{ count: number | string }>(
    "select count(*)::int as count from audit_logs where tenant_id = $1 and action in ($2, $3, $4)",
    [
      tenantId,
      "connector.webhook_secret_rotated",
      "connector.webhook_disabled",
      "connector.webhook_enabled",
    ],
  );

  return Number(result.rows[0]?.count ?? 0);
}

function signWebhookBody(secret: string, timestamp: string, body: string) {
  return `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")}`;
}
