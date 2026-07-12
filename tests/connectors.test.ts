import { afterEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  configureWebhookEndpointSecret,
} from "../src/modules/connectors/webhooks";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { db, services: createServices(db) };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("connectors", () => {
  it("imports CSV contacts and receives webhook leads", async () => {
    const { db, services } = await setup();
    const demo = await services.seedDemo();

    const report = await services.importCsvContacts(
      demo.user.id,
      demo.tenant.id,
      "nom,email,telephone\nAlicia Nilor,alicia@example.com,+596 696 44 55 66\nSans Email,,+596 696 00 00 00",
    );
    expect(report.imported).toBe(1);
    expect(report.invalid).toBe(1);

    const endpoint = await db.query<{ token: string }>(
      "select token from webhook_endpoints where tenant_id = $1 limit 1",
      [demo.tenant.id],
    );
    const payload = {
      name: "Client Webhook",
      email: "webhook@example.com",
      phone: "+596 696 77 88 99",
      message: "Demande API",
    };
    await services.receiveWebhook(endpoint.rows[0].token, payload, {
      body: JSON.stringify(payload),
      idempotencyKey: "webhook-basic",
    });

    const crm = await services.getCrm(demo.user.id, demo.tenant.id);
    expect(crm.contacts.some((contact) => contact.email === "webhook@example.com")).toBe(
      true,
    );
    expect(crm.leads.length).toBeGreaterThanOrEqual(2);
  });

  it("parses quoted CSV values with embedded commas", async () => {
    const { services } = await setup();
    const demo = await services.seedDemo();

    const report = await services.importCsvContacts(
      demo.user.id,
      demo.tenant.id,
      'nom,email,telephone\n"Cabinet Conseil, Martinique",cabinet@example.com,+596 696 01 02 03',
    );

    expect(report.imported).toBe(1);
    const crm = await services.getCrm(demo.user.id, demo.tenant.id);
    expect(
      crm.contacts.some((contact) => contact.name === "Cabinet Conseil, Martinique"),
    ).toBe(true);
  });

  it("requires a valid HMAC signature when a webhook endpoint has a secret", async () => {
    const { db, services } = await setup();
    const demo = await services.seedDemo();
    const endpoint = await db.query<{ id: string; token: string }>(
      "select id, token from webhook_endpoints where tenant_id = $1 limit 1",
      [demo.tenant.id],
    );
    const secret = "whsec_test_secret";
    const payload = {
      name: "Client Signe",
      email: "signed-webhook@example.com",
      phone: "+596 696 10 20 30",
      message: "Demande API signee",
    };
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();

    await configureWebhookEndpointSecret(db, {
      tenantId: demo.tenant.id,
      endpointId: endpoint.rows[0].id,
      secret,
    });

    await expect(
      services.receiveWebhook(endpoint.rows[0].token, payload),
    ).rejects.toThrow("Cle idempotence webhook manquante.");
    await expect(
      services.receiveWebhook(endpoint.rows[0].token, payload, {
        body,
        timestamp,
        idempotencyKey: "signed-missing",
      }),
    ).rejects.toThrow("Signature webhook manquante.");
    await expect(
      services.receiveWebhook(endpoint.rows[0].token, payload, {
        body,
        timestamp,
        signature: "sha256=bad",
        idempotencyKey: "signed-invalid",
      }),
    ).rejects.toThrow("Signature webhook invalide.");
    const expiredTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
    await expect(
      services.receiveWebhook(endpoint.rows[0].token, payload, {
        body,
        timestamp: expiredTimestamp,
        signature: signWebhookBody(secret, expiredTimestamp, body),
        idempotencyKey: "signed-expired",
      }),
    ).rejects.toThrow("Timestamp webhook expire.");

    await services.receiveWebhook(endpoint.rows[0].token, payload, {
      body,
      timestamp,
      signature: signWebhookBody(secret, timestamp, body),
      idempotencyKey: "signed-valid",
    });
    await expect(
      services.receiveWebhook(endpoint.rows[0].token, payload, {
        body,
        timestamp,
        signature: signWebhookBody(secret, timestamp, body),
        idempotencyKey: "signed-valid",
      }),
    ).rejects.toThrow("Livraison webhook deja recue.");

    const crm = await services.getCrm(demo.user.id, demo.tenant.id);
    const deliveries = await db.query<{
      status: string;
      idempotency_key: string | null;
    }>(
      "select status, idempotency_key from webhook_deliveries where tenant_id = $1 order by created_at asc",
      [demo.tenant.id],
    );

    expect(
      crm.contacts.some((contact) => contact.email === "signed-webhook@example.com"),
    ).toBe(true);
    expect(
      deliveries.rows.filter((delivery) => delivery.status === "rejected"),
    ).toHaveLength(5);
    expect(
      deliveries.rows.filter((delivery) => delivery.status === "accepted"),
    ).toHaveLength(1);
    expect(
      deliveries.rows.some(
        (delivery) => delivery.idempotency_key === "signed-valid",
      ),
    ).toBe(true);
  });

  it("rejects oversized webhook payloads and redacts sensitive delivery data", async () => {
    const { db, services } = await setup();
    const demo = await services.seedDemo();
    const endpoint = await db.query<{ token: string }>(
      "select token from webhook_endpoints where tenant_id = $1 limit 1",
      [demo.tenant.id],
    );
    const payload = {
      name: "Payload Trop Grand",
      email: "oversized-webhook@example.com",
      message: "x".repeat(70 * 1024),
      token: "super-secret-token",
    };

    await expect(
      services.receiveWebhook(endpoint.rows[0].token, payload, {
        body: JSON.stringify(payload),
        idempotencyKey: "oversized-webhook",
      }),
    ).rejects.toThrow("Payload webhook trop volumineux.");

    const deliveries = await db.query<{ payload: string; status: string }>(
      "select payload, status from webhook_deliveries where tenant_id = $1 order by created_at desc limit 1",
      [demo.tenant.id],
    );
    const recordedPayload = JSON.parse(deliveries.rows[0]!.payload) as {
      token: string;
      message: string;
    };

    expect(deliveries.rows[0]!.status).toBe("rejected");
    expect(recordedPayload.token).toBe("[redacted]");
    expect(recordedPayload.message.endsWith("[truncated]")).toBe(true);
  });
});

function signWebhookBody(secret: string, timestamp: string, body: string) {
  return `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")}`;
}
