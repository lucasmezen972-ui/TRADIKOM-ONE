import { afterEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  configureWebhookEndpointSecret,
} from "../src/modules/connectors/webhooks";
import { buildRateLimitKey } from "../src/modules/rate-limit";

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

    const endpoint = await db.query<{ id: string; token: string }>(
      "select id, token from webhook_endpoints where tenant_id = $1 limit 1",
      [demo.tenant.id],
    );
    const rotation = await services.generateWebhookEndpointSecret(
      demo.user.id,
      demo.tenant.id,
      endpoint.rows[0].id,
    );
    const payload = {
      name: "Client Webhook",
      email: "webhook@example.com",
      phone: "+596 696 77 88 99",
      message: "Demande API",
    };
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    await services.receiveWebhook(endpoint.rows[0].token, payload, {
      body,
      timestamp,
      signature: signWebhookBody(rotation.secret, timestamp, body),
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

  it("creates webhook secrets by default and rejects unsigned deliveries", async () => {
    const { db, services } = await setup();
    const demo = await services.seedDemo();
    const config = await services.getWebhookEndpointConfig(
      demo.user.id,
      demo.tenant.id,
    );
    const endpoint = await db.query<{
      token: string;
      secret_hash: string | null;
    }>(
      "select token, secret_hash from webhook_endpoints where tenant_id = $1 limit 1",
      [demo.tenant.id],
    );
    const versions = await db.query<{ count: number | string }>(
      "select count(*)::int as count from connector_secret_versions where tenant_id = $1 and connector_key = $2",
      [demo.tenant.id, "generic_webhook"],
    );

    expect(config.hasSecret).toBe(true);
    expect(endpoint.rows[0]!.secret_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(Number(versions.rows[0]!.count)).toBeGreaterThanOrEqual(1);
    await expect(
      services.receiveWebhook(
        endpoint.rows[0]!.token,
        { email: "unsigned-webhook@example.com" },
        {
          body: "{\"email\":\"unsigned-webhook@example.com\"}",
          idempotencyKey: "unsigned-default-secret",
        },
      ),
    ).rejects.toThrow("Signature webhook manquante.");
  });

  it("rejects old webhook secrets after rotation", async () => {
    const { db, services } = await setup();
    const demo = await services.seedDemo();
    const endpoint = await db.query<{ id: string; token: string }>(
      "select id, token from webhook_endpoints where tenant_id = $1 limit 1",
      [demo.tenant.id],
    );
    const initial = await services.generateWebhookEndpointSecret(
      demo.user.id,
      demo.tenant.id,
      endpoint.rows[0]!.id,
    );
    const firstPayload = {
      name: "Avant Rotation",
      email: "before-rotation-webhook@example.com",
      phone: "+596 696 40 41 42",
      message: "Avant rotation",
    };
    const firstBody = JSON.stringify(firstPayload);
    const firstTimestamp = Math.floor(Date.now() / 1000).toString();

    await services.receiveWebhook(endpoint.rows[0]!.token, firstPayload, {
      body: firstBody,
      timestamp: firstTimestamp,
      signature: signWebhookBody(initial.secret, firstTimestamp, firstBody),
      idempotencyKey: "rotation-before",
    });

    const rotated = await services.generateWebhookEndpointSecret(
      demo.user.id,
      demo.tenant.id,
      endpoint.rows[0]!.id,
    );
    const secondPayload = {
      name: "Apres Rotation",
      email: "after-rotation-webhook@example.com",
      phone: "+596 696 43 44 45",
      message: "Apres rotation",
    };
    const secondBody = JSON.stringify(secondPayload);
    const secondTimestamp = Math.floor(Date.now() / 1000).toString();

    await expect(
      services.receiveWebhook(endpoint.rows[0]!.token, secondPayload, {
        body: secondBody,
        timestamp: secondTimestamp,
        signature: signWebhookBody(initial.secret, secondTimestamp, secondBody),
        idempotencyKey: "rotation-old-secret",
      }),
    ).rejects.toThrow("Signature webhook invalide.");
    await services.receiveWebhook(endpoint.rows[0]!.token, secondPayload, {
      body: secondBody,
      timestamp: secondTimestamp,
      signature: signWebhookBody(rotated.secret, secondTimestamp, secondBody),
      idempotencyKey: "rotation-new-secret",
    });

    const crm = await services.getCrm(demo.user.id, demo.tenant.id);
    expect(
      crm.contacts.some(
        (contact) => contact.email === "after-rotation-webhook@example.com",
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

  it("redacts disabled and invalid-signature rejected webhook deliveries", async () => {
    const { db, services } = await setup();
    const demo = await services.seedDemo();
    const endpoint = await db.query<{ id: string; token: string }>(
      "select id, token from webhook_endpoints where tenant_id = $1 limit 1",
      [demo.tenant.id],
    );
    const disabledPayload = {
      email: "disabled-redacted@example.com",
      phone: "+596 696 51 52 53",
      token: "disabled-token",
      password: "disabled-password",
      authorization: "Bearer disabled",
      profile: { secret: "nested-secret" },
    };

    await services.setWebhookEndpointStatus(
      demo.user.id,
      demo.tenant.id,
      endpoint.rows[0]!.id,
      "disabled",
    );
    await expect(
      services.receiveWebhook(endpoint.rows[0]!.token, disabledPayload, {
        body: JSON.stringify(disabledPayload),
        idempotencyKey: "disabled-redacted",
      }),
    ).rejects.toThrow("Webhook desactive.");

    await services.setWebhookEndpointStatus(
      demo.user.id,
      demo.tenant.id,
      endpoint.rows[0]!.id,
      "active",
    );
    const rotation = await services.generateWebhookEndpointSecret(
      demo.user.id,
      demo.tenant.id,
      endpoint.rows[0]!.id,
    );
    const signedPayload = {
      email: "signature-redacted@example.com",
      phone: "+596 696 54 55 56",
      apiKey: "signature-api-key",
      message: "Signature invalide",
    };
    const signedBody = JSON.stringify(signedPayload);
    const timestamp = Math.floor(Date.now() / 1000).toString();

    await expect(
      services.receiveWebhook(endpoint.rows[0]!.token, signedPayload, {
        body: signedBody,
        timestamp,
        signature: signWebhookBody(rotation.secret, timestamp, "{}"),
        idempotencyKey: "signature-redacted",
      }),
    ).rejects.toThrow("Signature webhook invalide.");

    const deliveries = await db.query<{
      idempotency_key: string | null;
      payload: string;
      status: string;
    }>(
      `select idempotency_key, payload, status
       from webhook_deliveries
       where tenant_id = $1
         and idempotency_key in ($2, $3)
       order by created_at asc`,
      [demo.tenant.id, "disabled-redacted", "signature-redacted"],
    );
    const disabledDelivery = deliveries.rows.find(
      (delivery) => delivery.idempotency_key === "disabled-redacted",
    )!;
    const signatureDelivery = deliveries.rows.find(
      (delivery) => delivery.idempotency_key === "signature-redacted",
    )!;
    const disabledRecorded = JSON.parse(disabledDelivery.payload) as {
      token: string;
      password: string;
      authorization: string;
      profile: string;
    };
    const signatureRecorded = JSON.parse(signatureDelivery.payload) as {
      apiKey: string;
    };

    expect(disabledDelivery.status).toBe("rejected");
    expect(signatureDelivery.status).toBe("rejected");
    expect(disabledRecorded.token).toBe("[redacted]");
    expect(disabledRecorded.password).toBe("[redacted]");
    expect(disabledRecorded.authorization).toBe("[redacted]");
    expect(disabledRecorded.profile).toBe("[object]");
    expect(signatureRecorded.apiKey).toBe("[redacted]");
  });

  it("keeps webhook rate limits endpoint-scoped and redacts rate-limit rejections", async () => {
    const { db, services } = await setup();
    const demo = await services.seedDemo();
    const other = await services.registerUser({
      name: "Tenant Webhook Rate",
      email: "tenant-rate@example.com",
      password: "password123",
    });
    const otherTenant = await services.createTenant(other.id, {
      name: "Tenant Rate",
      category: "Garage",
    });
    const [demoEndpoint, otherEndpoint] = await Promise.all([
      loadWebhookEndpoint(db, demo.tenant.id),
      loadWebhookEndpoint(db, otherTenant.id),
    ]);
    const now = new Date().toISOString();

    await db.query(
      `insert into rate_limits (id, key, count, reset_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        "rate_webhook_demo_limit",
        buildRateLimitKey({
          operationKey: "webhook.receive",
          subjectKey: demoEndpoint.id,
          scopeKey: demo.tenant.id,
        }),
        60,
        new Date(Date.now() + 60_000).toISOString(),
        now,
        now,
      ],
    );

    const limitedPayload = {
      email: "rate-limited@example.com",
      phone: "+596 696 57 58 59",
      secret: "rate-limit-secret",
    };
    const limitedError = await services
      .receiveWebhook(demoEndpoint.token, limitedPayload, {
        body: JSON.stringify(limitedPayload),
        idempotencyKey: "rate-limited-redacted",
      })
      .catch((error: unknown) => error);
    expect(limitedError).toMatchObject({
      code: "webhook_rate_limited",
      message: "Trop de requetes webhook.",
      retryAfterSeconds: expect.any(Number),
    });

    const otherRotation = await services.generateWebhookEndpointSecret(
      other.id,
      otherTenant.id,
      otherEndpoint.id,
    );
    const otherPayload = {
      name: "Rate Isolated",
      email: "rate-isolated@example.com",
      phone: "+596 696 60 61 62",
    };
    const otherBody = JSON.stringify(otherPayload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    await services.receiveWebhook(otherEndpoint.token, otherPayload, {
      body: otherBody,
      timestamp,
      signature: signWebhookBody(otherRotation.secret, timestamp, otherBody),
      idempotencyKey: "rate-limited-redacted",
    });

    const limitedDelivery = await db.query<{ payload: string; status: string }>(
      `select payload, status
       from webhook_deliveries
       where tenant_id = $1 and idempotency_key = $2
       limit 1`,
      [demo.tenant.id, "rate-limited-redacted"],
    );
    const otherDeliveries = await db.query<{ status: string }>(
      `select status
       from webhook_deliveries
       where tenant_id = $1 and idempotency_key = $2`,
      [otherTenant.id, "rate-limited-redacted"],
    );
    const demoCrm = await services.getCrm(demo.user.id, demo.tenant.id);
    const otherCrm = await services.getCrm(other.id, otherTenant.id);
    const recordedPayload = JSON.parse(limitedDelivery.rows[0]!.payload) as {
      secret: string;
    };

    expect(limitedDelivery.rows[0]!.status).toBe("rejected");
    expect(recordedPayload.secret).toBe("[redacted]");
    expect(otherDeliveries.rows).toEqual([{ status: "accepted" }]);
    expect(
      demoCrm.contacts.some(
        (contact) => contact.email === "rate-limited@example.com",
      ),
    ).toBe(false);
    expect(
      otherCrm.contacts.some((contact) => contact.email === "rate-isolated@example.com"),
    ).toBe(true);
  });
});

async function loadWebhookEndpoint(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  tenantId: string,
) {
  const endpoint = await db.query<{ id: string; token: string }>(
    "select id, token from webhook_endpoints where tenant_id = $1 limit 1",
    [tenantId],
  );

  return endpoint.rows[0]!;
}

function signWebhookBody(secret: string, timestamp: string, body: string) {
  return `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")}`;
}
