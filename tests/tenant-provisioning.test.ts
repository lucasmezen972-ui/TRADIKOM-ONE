import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("tenant provisioning", () => {
  it("creates default resources and encrypted webhook material for one tenant", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Provisioning Owner",
      email: "provisioning-owner@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Provisioning Garage",
      category: "Garage automobile",
    });
    const otherOwner = await services.registerUser({
      name: "Other Provisioning Owner",
      email: "other-provisioning-owner@example.com",
      password: "Password!1",
    });
    const otherTenant = await services.createTenant(otherOwner.id, {
      name: "Other Provisioning Garage",
      category: "Garage automobile",
    });

    expect(await tenantCount(db, "pipelines", tenant.id)).toBe(1);
    expect(await tenantCount(db, "pipeline_stages", tenant.id)).toBe(6);
    expect(await tenantCount(db, "workflows", tenant.id)).toBe(1);
    expect(await tenantCount(db, "connectors", tenant.id)).toBe(3);
    expect(await tenantCount(db, "webhook_endpoints", tenant.id)).toBe(1);
    expect(await tenantCount(db, "connector_secret_versions", tenant.id)).toBe(1);
    expect(await tenantCount(db, "ai_employee_profiles", tenant.id)).toBe(9);
    expect(await tenantCount(db, "ai_employee_activity_logs", tenant.id)).toBe(9);
    expect(await tenantCount(db, "pipelines", otherTenant.id)).toBe(1);
    expect(await tenantCount(db, "pipeline_stages", otherTenant.id)).toBe(6);
    expect(await tenantCount(db, "connectors", otherTenant.id)).toBe(3);
    expect(await tenantCount(db, "connector_secret_versions", otherTenant.id)).toBe(
      1,
    );
    expect(await tenantCount(db, "ai_employee_profiles", otherTenant.id)).toBe(9);
    expect(await tenantCount(db, "ai_employee_activity_logs", otherTenant.id)).toBe(9);

    const endpoint = await db.query<{
      secret_hash: string | null;
    }>("select secret_hash from webhook_endpoints where tenant_id = $1", [
      tenant.id,
    ]);
    expect(endpoint.rows[0]?.secret_hash).toBeTruthy();
  });
});

async function tenantCount(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  table: string,
  tenantId: string,
) {
  const result = await db.query<{ count: number | string }>(
    `select count(*) as count from ${table} where tenant_id = $1`,
    [tenantId],
  );
  return Number(result.rows[0]?.count ?? 0);
}
