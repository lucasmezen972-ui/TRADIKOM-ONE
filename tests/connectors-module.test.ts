import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  getConnectors,
  getWebhookEndpointConfig,
  importCsvContacts,
  receiveWebhook,
  rotateWebhookEndpointSecret,
  setWebhookEndpointStatus,
  syncMockConnector,
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

    await syncMockConnector(db, demo.user.id, demo.tenant.id);
    const connectors = await getConnectors(db, demo.user.id, demo.tenant.id);
    expect(
      connectors.find((connector) => connector.key === "mock_business")?.health,
    ).toBe("healthy");

    const endpoint = await db.query<{ token: string }>(
      "select token from webhook_endpoints where tenant_id = $1 limit 1",
      [demo.tenant.id],
    );
    const payload = {
      name: "Module Webhook",
      email: "module-webhook@example.com",
      phone: "+596 696 10 11 12",
      message: "Demande module",
    };
    await receiveWebhook(db, endpoint.rows[0]!.token, payload, {
      body: JSON.stringify(payload),
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
    expect(config.hasSecret).toBe(false);
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

    await rotateWebhookEndpointSecret(db, demo.user.id, demo.tenant.id, {
      endpointId: config.id,
      secret,
    });
    const secured = await getWebhookEndpointConfig(
      db,
      demo.user.id,
      demo.tenant.id,
    );
    expect(secured.hasSecret).toBe(true);

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
    ).rejects.toThrow("Webhook invalide.");

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
