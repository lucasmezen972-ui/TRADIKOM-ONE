import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { getAuditLogs } from "../src/modules/audit";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("audit module", () => {
  it("lists only authorized tenant logs with a bounded query", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const firstOwner = await services.registerUser({
      name: "First Audit Owner",
      email: "first-audit-owner@example.com",
      password: "Password!1",
    });
    const secondOwner = await services.registerUser({
      name: "Second Audit Owner",
      email: "second-audit-owner@example.com",
      password: "Password!1",
    });
    const firstTenant = await services.createTenant(firstOwner.id, {
      name: "First Audit Garage",
      category: "Garage automobile",
    });
    const secondTenant = await services.createTenant(secondOwner.id, {
      name: "Second Audit Garage",
      category: "Garage automobile",
    });

    const logs = await getAuditLogs(db, firstOwner.id, firstTenant.id, {
      limit: 1,
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.tenantId).toBe(firstTenant.id);
    expect(logs[0]?.tenantId).not.toBe(secondTenant.id);
    await expect(
      getAuditLogs(db, secondOwner.id, firstTenant.id),
    ).rejects.toThrow("Acces refuse");
  });
});
