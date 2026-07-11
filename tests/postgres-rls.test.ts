import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { pgPoolAsSqlClient } from "../src/db/client";
import { migrate } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { id, nowIso, toJson } from "../src/lib/security";

const databaseUrl = process.env.DATABASE_URL;
const describeIfPostgres = databaseUrl ? describe : describe.skip;
const ownerPools: Pool[] = [];
const restrictedPools: Pool[] = [];
const restrictedRoles: Array<{ ownerPool: Pool; roleName: string }> = [];

afterEach(async () => {
  await Promise.all(restrictedPools.splice(0).map((pool) => pool.end()));
  for (const role of restrictedRoles.splice(0)) {
    await dropRestrictedRole(role.ownerPool, role.roleName);
  }
  await Promise.all(ownerPools.splice(0).map((pool) => pool.end()));
});

describeIfPostgres("PostgreSQL RLS", () => {
  it("isolates tenant-owned rows for a restricted non-owner database role", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for this test.");
    }

    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });

    const services = createServices(ownerDb);
    const ownerA = await services.registerUser({
      name: "RLS Owner A",
      email: uniqueEmail("rls-owner-a"),
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "RLS Owner B",
      email: uniqueEmail("rls-owner-b"),
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: `Garage RLS A ${randomUUID()}`,
      category: "Garage automobile",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: `Garage RLS B ${randomUUID()}`,
      category: "Garage automobile",
    });
    await insertContact(ownerDb, tenantA.id, ownerA.id, "alpha@example.com");
    await insertContact(ownerDb, tenantB.id, ownerB.id, "bravo@example.com");

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);

    const noContext = await restrictedPool.query<{ email: string }>(
      "select email from contacts order by email",
    );
    expect(noContext.rows).toEqual([]);

    const tenantARows = await withTenantContext(
      restrictedPool,
      tenantA.id,
      async (client) =>
        client.query<{ email: string }>("select email from contacts order by email"),
    );
    expect(tenantARows.rows.map((row) => row.email)).toEqual([
      "alpha@example.com",
    ]);

    await expect(
      withTenantContext(restrictedPool, tenantA.id, async (client) =>
        client.query(
          `insert into contacts (id, tenant_id, name, email, phone, status, source, tags, assigned_user_id, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            id("contact"),
            tenantB.id,
            "Cross Tenant",
            "cross@example.com",
            "+596 696 00 00 00",
            "Nouveau",
            "test",
            toJson(["test"]),
            ownerA.id,
            nowIso(),
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/);
  });
});

async function insertContact(
  db: ReturnType<typeof pgPoolAsSqlClient>,
  tenantId: string,
  ownerId: string,
  email: string,
) {
  const now = nowIso();
  await db.query(
    `insert into contacts (id, tenant_id, name, email, phone, status, source, tags, assigned_user_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id("contact"),
      tenantId,
      email,
      email,
      "+596 696 00 00 00",
      "Nouveau",
      "test",
      toJson(["test"]),
      ownerId,
      now,
      now,
    ],
  );
}

async function createRestrictedRole(ownerPool: Pool) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for restricted role creation.");
  }

  const roleName = `tradikom_rls_${randomUUID().replaceAll("-", "")}`;
  const password = randomUUID().replaceAll("-", "");
  const roleIdentifier = quoteIdentifier(roleName);

  await ownerPool.query(
    `create role ${roleIdentifier} login password ${quoteLiteral(password)}`,
  );
  await ownerPool.query(`grant usage on schema public to ${roleIdentifier}`);
  await ownerPool.query(
    `grant select, insert, update, delete on all tables in schema public to ${roleIdentifier}`,
  );

  const restrictedUrl = new URL(databaseUrl);
  restrictedUrl.username = roleName;
  restrictedUrl.password = password;

  return { roleName, databaseUrl: restrictedUrl.toString() };
}

async function dropRestrictedRole(ownerPool: Pool, roleName: string) {
  const roleIdentifier = quoteIdentifier(roleName);
  await ownerPool.query(`drop owned by ${roleIdentifier}`);
  await ownerPool.query(`drop role if exists ${roleIdentifier}`);
}

async function withTenantContext<T>(
  pool: Pool,
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.com`;
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
