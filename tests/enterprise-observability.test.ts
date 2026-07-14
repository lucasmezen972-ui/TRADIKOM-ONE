import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { id, toJson } from "../src/lib/security";
import { getEnterpriseObservability } from "../src/modules/enterprise-observability";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("Enterprise Observability", () => {
  it("reports only measured tenant signals and keeps unsupported telemetry unknown", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Health Owner",
      email: "health-owner@example.com",
      password: "Password!1",
    });
    const outsider = await services.registerUser({
      name: "Health Outsider",
      email: "health-outsider@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Health Garage",
      category: "Garage automobile",
    });
    const cleanTenant = await services.createTenant(owner.id, {
      name: "Clean Garage",
      category: "Garage automobile",
    });
    const now = new Date("2026-07-14T12:00:00.000Z");
    const old = new Date(now.getTime() - 60 * 60 * 1_000).toISOString();
    const secretMarker = "raw-customer-secret-marker";

    await db.query(
      `update connectors set status = 'Connecté', health = 'error', updated_at = $1
       where tenant_id = $2 and connector_key = 'mock_business'`,
      [old, tenant.id],
    );
    await db.query(
      `insert into domain_events (
         id, tenant_id, actor_id, event_type, payload, status, attempts,
         idempotency_key, correlation_id, next_run_at, last_error,
         last_attempted_at, last_retry_delay_ms, failure_classification,
         max_attempts, created_at, updated_at
       ) values ($1, $2, $3, 'notification.dispatch_requested', $4, 'failed', 3,
         $5, $6, $7, $8, $7, 1000, 'permanent', 3, $7, $7)`,
      [
        id("event"),
        tenant.id,
        owner.id,
        toJson({ message: secretMarker }),
        id("health-idempotency"),
        id("correlation"),
        old,
        secretMarker,
      ],
    );
    await db.query(
      `insert into notifications (
         id, tenant_id, channel, recipient_user_id, message, status, created_at
       ) values ($1, $2, 'email', $3, $4, 'queued', $5)`,
      [id("notification"), tenant.id, owner.id, secretMarker, old],
    );
    const endpoint = await db.query<{ id: string }>(
      "select id from webhook_endpoints where tenant_id = $1 limit 1",
      [tenant.id],
    );
    const endpointId = endpoint.rows[0]?.id;
    if (!endpointId) throw new Error("Missing webhook endpoint fixture.");
    await db.query(
      `insert into webhook_deliveries (
         id, tenant_id, webhook_endpoint_id, status, idempotency_key,
         payload, error, created_at
       ) values ($1, $2, $3, 'rejected', $4, $5, $6, $7)`,
      [
        id("delivery"),
        tenant.id,
        endpointId,
        id("delivery-key"),
        toJson({ token: secretMarker }),
        secretMarker,
        old,
      ],
    );

    const workspace = await getEnterpriseObservability(
      db,
      owner.id,
      tenant.id,
      { now },
    );
    expect(workspace.scope).toBe("tenant");
    expect(workspace.capturedAt).toBe(now.toISOString());
    expect(metric(workspace, "database")).toMatchObject({
      status: "healthy",
      measured: true,
    });
    expect(metric(workspace, "queues")).toMatchObject({ status: "critical" });
    expect(metric(workspace, "connectors")).toMatchObject({ status: "critical" });
    expect(metric(workspace, "email")).toMatchObject({ status: "critical" });
    expect(metric(workspace, "security")).toMatchObject({ status: "attention" });
    expect(metric(workspace, "workers")).toMatchObject({
      status: "unavailable",
      measured: false,
      action: null,
    });
    expect(metric(workspace, "cpu").summary).toContain("Aucune métrique CPU");
    expect(workspace.overview.unavailable).toBe(8);
    expect(JSON.stringify(workspace)).not.toContain(secretMarker);

    const cleanWorkspace = await getEnterpriseObservability(
      db,
      owner.id,
      cleanTenant.id,
      { now },
    );
    expect(metric(cleanWorkspace, "queues").status).toBe("healthy");
    expect(metric(cleanWorkspace, "email").status).toBe("healthy");
    expect(metric(cleanWorkspace, "security").status).toBe("healthy");
    expect(metric(cleanWorkspace, "connectors").status).not.toBe("critical");

    await expect(
      services.getEnterpriseObservability(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
  });

  it("keeps reads free of operational and audit side effects", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Read Only Owner",
      email: "health-read-only@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Read Only Garage",
      category: "Garage automobile",
    });
    const before = await operationalCounts(db, tenant.id);

    await services.getEnterpriseObservability(owner.id, tenant.id);
    await services.getEnterpriseObservability(owner.id, tenant.id);

    expect(await operationalCounts(db, tenant.id)).toEqual(before);
  });
});

function metric(
  workspace: Awaited<ReturnType<typeof getEnterpriseObservability>>,
  key: string,
) {
  const found = workspace.metrics.find((item) => item.key === key);
  if (!found) throw new Error(`Missing operational metric: ${key}`);
  return found;
}

async function operationalCounts(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  tenantId: string,
) {
  const result = await db.query<{
    events: number | string;
    runs: number | string;
    audits: number | string;
  }>(
    `select
       (select count(*)::int from domain_events where tenant_id = $1) as events,
       (select count(*)::int from workflow_runs where tenant_id = $1) as runs,
       (select count(*)::int from audit_logs where tenant_id = $1) as audits`,
    [tenantId],
  );
  return result.rows[0];
}
