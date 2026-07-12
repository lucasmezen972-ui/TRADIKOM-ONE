import { afterEach, describe, expect, it } from "vitest";
import { withTenantDbTransaction } from "../src/db/tenant-context";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import { createTenant } from "../src/modules/tenants";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("critical transaction boundaries", () => {
  it("rolls back tenant, membership, defaults, and audit together", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const user = await createServices(db).registerUser({
      name: "Owner Rollback",
      email: "owner-rollback@example.com",
      password: "Password!1",
    });

    await expect(
      createTenant(
        db,
        user.id,
        { name: "Tenant incomplet", category: "Garage automobile" },
        {
          async createDefaults(transaction, tenantId) {
            await transaction.query(
              "insert into pipelines (id, tenant_id, name, created_at) values ($1, $2, $3, $4)",
              [
                "pipeline_partial",
                tenantId,
                "Pipeline partiel",
                "2026-07-12T18:00:00.000Z",
              ],
            );
            throw new Error("simulated provisioning failure");
          },
        },
      ),
    ).rejects.toThrow("simulated provisioning failure");

    expect(await tableCount(db, "tenants")).toBe(0);
    expect(await tableCount(db, "memberships")).toBe(0);
    expect(await tableCount(db, "pipelines")).toBe(0);
    expect(await tableCount(db, "audit_logs")).toBe(0);
  });

  it("rolls back Business Twin, website generation, and audit together", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const user = await services.registerUser({
      name: "Onboarding Rollback",
      email: "onboarding-rollback@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Garage Rollback",
      category: "Garage automobile",
    });
    const auditsBefore = await tableCount(db, "audit_logs");
    const failingDb: DbClient = {
      async query<T>(sql: string, params?: unknown[]) {
        if (sql.includes("insert into website_sections")) {
          throw new Error("simulated website generation failure");
        }
        return db.query<T>(sql, params);
      },
    };

    await expect(
      createServices(failingDb).saveOnboarding(
        user.id,
        tenant.id,
        defaultGarageOnboarding(),
      ),
    ).rejects.toThrow("simulated website generation failure");

    expect(await tableCount(db, "business_profiles")).toBe(0);
    expect(await tableCount(db, "websites")).toBe(0);
    expect(await tableCount(db, "website_sections")).toBe(0);
    expect(await tableCount(db, "audit_logs")).toBe(auditsBefore);
  });

  it("uses an injected client even when DATABASE_URL is configured", async () => {
    const db = await createMemoryDb();
    opened.push(db);

    await withTenantDbTransaction(
      db,
      "tenant_injected",
      "user_injected",
      async (transaction) => {
        await transaction.query(
          "insert into users (id, name, email, password_hash, created_at) values ($1, $2, $3, $4, $5)",
          [
            "user_injected",
            "Injected",
            "injected@example.com",
            "hash",
            "2026-07-12T18:00:00.000Z",
          ],
        );
      },
    );

    expect(await tableCount(db, "users")).toBe(1);
  });

  it("rolls back publication snapshot, live pointer, record, and audit", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const user = await services.registerUser({
      name: "Publication Rollback",
      email: "publication-rollback@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Site Rollback",
      category: "Garage automobile",
    });
    await services.saveOnboarding(
      user.id,
      tenant.id,
      defaultGarageOnboarding(),
    );
    const versionsBefore = await tableCount(db, "website_versions");
    const auditsBefore = await tableCount(db, "audit_logs");
    const failingDb = failQuery(db, "insert into website_publications");

    await expect(
      createServices(failingDb).publishWebsite(user.id, tenant.id),
    ).rejects.toThrow("simulated transaction failure");

    expect(await tableCount(db, "website_versions")).toBe(versionsBefore);
    expect(await tableCount(db, "website_publications")).toBe(0);
    expect(await tableCount(db, "audit_logs")).toBe(auditsBefore);
    const website = await db.query<{
      status: string;
      current_published_version_id: string | null;
    }>("select status, current_published_version_id from websites where tenant_id = $1", [
      tenant.id,
    ]);
    expect(website.rows[0]).toMatchObject({
      status: "draft",
      current_published_version_id: null,
    });
  });

  it("rolls back public CRM writes and durable event when form persistence fails", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const user = await services.registerUser({
      name: "Lead Rollback",
      email: "lead-rollback@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Lead Rollback Garage",
      category: "Garage automobile",
    });
    await services.saveOnboarding(
      user.id,
      tenant.id,
      defaultGarageOnboarding(),
    );
    await services.publishWebsite(user.id, tenant.id);
    const auditsBefore = await tableCount(db, "audit_logs");
    const failingDb = failQuery(db, "insert into form_submissions");

    await expect(
      createServices(failingDb).submitPublicLead(tenant.slug, {
        name: "Lead transaction",
        email: "lead-transaction@example.com",
        phone: "0696000000",
        message: "Je souhaite être rappelé.",
        idempotencyKey: "transaction-lead-key",
      }),
    ).rejects.toThrow("simulated transaction failure");

    expect(await tableCount(db, "contacts")).toBe(0);
    expect(await tableCount(db, "leads")).toBe(0);
    expect(await tableCount(db, "opportunities")).toBe(0);
    expect(await tableCount(db, "activities")).toBe(0);
    expect(await tableCount(db, "domain_events")).toBe(0);
    expect(await tableCount(db, "form_submissions")).toBe(0);
    expect(await tableCount(db, "audit_logs")).toBe(auditsBefore);
  });
});

async function tableCount(db: DbClient, table: string) {
  const result = await db.query<{ count: number | string }>(
    `select count(*) as count from ${table}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

function failQuery(db: DbClient, fragment: string): DbClient {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      if (sql.includes(fragment)) {
        throw new Error("simulated transaction failure");
      }
      return db.query<T>(sql, params);
    },
  };
}
