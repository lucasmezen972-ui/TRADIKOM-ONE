import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { registerUser } from "../src/modules/auth";
import {
  assertTenantAccess,
  createTenant,
  type TenantError,
} from "../src/modules/tenants";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { db };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("tenants module", () => {
  it("creates an owner membership and audits the organization creation", async () => {
    const { db } = await setup();
    const owner = await registerUser(db, {
      name: "Malia Tenant",
      email: "malia.tenant@example.com",
      password: "Password!1",
    });
    const outsider = await registerUser(db, {
      name: "Outsider",
      email: "outsider@example.com",
      password: "Password!1",
    });

    const tenant = await createTenant(
      db,
      owner.id,
      { name: "Garage Tenant", category: "Garage automobile" },
      { createDefaults: async () => undefined },
    );

    await expect(assertTenantAccess(db, owner.id, tenant.id)).resolves.toBe(
      "owner",
    );
    await expect(
      assertTenantAccess(db, outsider.id, tenant.id),
    ).rejects.toMatchObject({
      name: "TenantError",
      code: "tenant_access_denied",
      message: "Acces refuse pour cette organisation.",
    } satisfies Partial<TenantError>);

    const audit = await db.query<{ action: string; target_id: string }>(
      "select action, target_id from audit_logs where tenant_id = $1",
      [tenant.id],
    );
    expect(audit.rows).toContainEqual({
      action: "organization.created",
      target_id: tenant.id,
    });
  });
});
