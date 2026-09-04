import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { pgPoolAsSqlClient } from "../src/db/client";
import { migrate } from "../src/lib/db";

const databaseUrl = process.env.DATABASE_URL;
const describeIfPostgres = databaseUrl ? describe : describe.skip;
const ownerPools: Pool[] = [];
const restrictedPools: Pool[] = [];
const restrictedRoles: Array<{ ownerPool: Pool; roleName: string }> = [];
const timestamp = "2026-09-04T19:30:00.000Z";

afterEach(async () => {
  await Promise.all(restrictedPools.splice(0).map((pool) => pool.end()));
  for (const role of restrictedRoles.splice(0)) {
    await dropRestrictedRole(role.ownerPool, role.roleName);
  }
  await Promise.all(ownerPools.splice(0).map((pool) => pool.end()));
});

describeIfPostgres("RLS PostgreSQL de la classification des fils", () => {
  it("isole lecture, modification et insertion des droits par tenant", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });
    const unique = randomUUID().replaceAll("-", "");
    const tenantA = `tenant_thread_access_a_${unique}`;
    const tenantB = `tenant_thread_access_b_${unique}`;
    const threadA = `thread_access_a_${unique}`;
    const threadB = `thread_access_b_${unique}`;
    await ownerDb.query(
      `insert into tenants (id, name, slug, category, created_at)
       values
         ($1, 'Organisation A', $1, 'Services', $3),
         ($2, 'Organisation B', $2, 'Services', $3)`,
      [tenantA, tenantB, timestamp],
    );
    await ownerDb.query(
      `insert into conversation_threads (
         id, tenant_id, status, subject, confidentiality_level,
         visibility_scope, created_at, updated_at
       ) values
         ($1, $2, 'open', null, 'restricted', 'team', $5, $5),
         ($3, $4, 'open', null, 'secret', 'personal', $5, $5)`,
      [threadA, tenantA, threadB, tenantB, timestamp],
    );

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);
    const own = await withTenantContext(restrictedPool, tenantA, (client) =>
      client.query(
        `select id, confidentiality_level, visibility_scope
         from conversation_threads order by id`,
      ),
    );
    expect(own.rows).toEqual([{
      id: threadA,
      confidentiality_level: "restricted",
      visibility_scope: "team",
    }]);
    const crossUpdate = await withTenantContext(
      restrictedPool,
      tenantA,
      (client) => client.query(
        `update conversation_threads
         set confidentiality_level = 'public'
         where tenant_id = $1 and id = $2 returning id`,
        [tenantB, threadB],
      ),
    );
    expect(crossUpdate.rows).toEqual([]);
    await expect(
      withTenantContext(restrictedPool, tenantA, (client) =>
        client.query(
          `insert into conversation_threads (
             id, tenant_id, status, subject, confidentiality_level,
             visibility_scope, created_at, updated_at
           ) values (
             'thread_access_cross', $1, 'open', null, 'internal', 'tenant',
             $2, $2
           )`,
          [tenantB, timestamp],
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });
});

async function createRestrictedRole(ownerPool: Pool) {
  if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
  const roleName = `tradikom_thread_access_${randomUUID().replaceAll("-", "")}`;
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

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
