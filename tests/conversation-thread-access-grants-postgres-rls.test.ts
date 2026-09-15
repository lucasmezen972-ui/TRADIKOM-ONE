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
const timestamp = "2026-09-04T20:25:00.000Z";

afterEach(async () => {
  await Promise.all(restrictedPools.splice(0).map((pool) => pool.end()));
  for (const role of restrictedRoles.splice(0)) {
    await dropRestrictedRole(role.ownerPool, role.roleName);
  }
  await Promise.all(ownerPools.splice(0).map((pool) => pool.end()));
});

describeIfPostgres("RLS PostgreSQL des autorisations de fil", () => {
  it("isole select/insert/update/delete et les relations composées", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });
    const unique = randomUUID().replaceAll("-", "");
    const tenantA = `tenant_grant_rls_a_${unique}`;
    const tenantB = `tenant_grant_rls_b_${unique}`;
    const ownerA = `user_grant_rls_a_${unique}`;
    const memberA = `user_grant_rls_member_a_${unique}`;
    const ownerB = `user_grant_rls_b_${unique}`;
    const threadA = `thread_grant_rls_a_${unique}`;
    const threadB = `thread_grant_rls_b_${unique}`;
    await ownerDb.query(
      `insert into users (id, name, email, password_hash, created_at)
       values
         ($1, 'Propriétaire A', $1 || '@example.com', 'hash', $4),
         ($2, 'Membre A', $2 || '@example.com', 'hash', $4),
         ($3, 'Propriétaire B', $3 || '@example.com', 'hash', $4)`,
      [ownerA, memberA, ownerB, timestamp],
    );
    await ownerDb.query(
      `insert into tenants (id, name, slug, category, created_at)
       values
         ($1, 'Organisation A', $1, 'Services', $3),
         ($2, 'Organisation B', $2, 'Services', $3)`,
      [tenantA, tenantB, timestamp],
    );
    await ownerDb.query(
      `insert into memberships (tenant_id, user_id, role, created_at)
       values
         ($1, $2, 'owner', $6),
         ($1, $3, 'collaborator', $6),
         ($4, $5, 'owner', $6)`,
      [tenantA, ownerA, memberA, tenantB, ownerB, timestamp],
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
    await ownerDb.query(
      `insert into conversation_thread_access_grants (
         tenant_id, thread_id, user_id, scope, granted_by_user_id, granted_at
       ) values
         ($1, $2, $3, 'team', $3, $7),
         ($4, $5, $6, 'personal', $6, $7)`,
      [tenantA, threadA, ownerA, tenantB, threadB, ownerB, timestamp],
    );
    await ownerDb.query(
      `insert into conversation_thread_access_operations (
         id, tenant_id, thread_id, idempotency_key_hash, input_fingerprint,
         requested_by_user_id, visibility_scope, grant_count, configured_at
       ) values
         ($1, $2, $3, $4, $5, $6, 'team', 1, $10),
         ($7, $8, $9, $11, $12, $13, 'personal', 1, $10)`,
      [
        `operation_a_${unique}`,
        tenantA,
        threadA,
        "a".repeat(64),
        "b".repeat(64),
        ownerA,
        `operation_b_${unique}`,
        tenantB,
        threadB,
        timestamp,
        "c".repeat(64),
        "d".repeat(64),
        ownerB,
      ],
    );

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);
    const own = await withTenantContext(restrictedPool, tenantA, (client) =>
      client.query(
        `select thread_id, user_id, scope
         from conversation_thread_access_grants
         order by thread_id, user_id`,
      ),
      ownerA,
    );
    expect(own.rows).toEqual([{ thread_id: threadA, user_id: ownerA, scope: "team" }]);
    const ownOperations = await withTenantContext(
      restrictedPool,
      tenantA,
      (client) => client.query(`select thread_id from conversation_thread_access_operations`),
      ownerA,
    );
    expect(ownOperations.rows).toEqual([{ thread_id: threadA }]);
    const hiddenFromMember = await withTenantContext(
      restrictedPool,
      tenantA,
      (client) => client.query(
        `select user_id from conversation_thread_access_grants order by user_id`,
      ),
      memberA,
    );
    expect(hiddenFromMember.rows).toEqual([]);
    const operationsHiddenFromMember = await withTenantContext(
      restrictedPool,
      tenantA,
      (client) => client.query(`select id from conversation_thread_access_operations`),
      memberA,
    );
    expect(operationsHiddenFromMember.rows).toEqual([]);

    const crossUpdate = await withTenantContext(
      restrictedPool,
      tenantA,
      (client) => client.query(
        `update conversation_thread_access_grants
         set scope = 'case'
         where tenant_id = $1 and thread_id = $2
         returning thread_id`,
        [tenantB, threadB],
      ),
      ownerA,
    );
    expect(crossUpdate.rows).toEqual([]);
    const crossDelete = await withTenantContext(
      restrictedPool,
      tenantA,
      (client) => client.query(
        `delete from conversation_thread_access_grants
         where tenant_id = $1 and thread_id = $2
         returning thread_id`,
        [tenantB, threadB],
      ),
      ownerA,
    );
    expect(crossDelete.rows).toEqual([]);
    await expect(
      withTenantContext(restrictedPool, tenantA, (client) =>
        client.query(
          `insert into conversation_thread_access_grants (
             tenant_id, thread_id, user_id, scope, granted_by_user_id, granted_at
           ) values ($1, $2, $3, 'team', $3, $4)`,
          [tenantB, threadB, ownerB, timestamp],
        ),
        ownerA,
      ),
    ).rejects.toThrow(/row-level security|violates/i);
    await expect(
      withTenantContext(restrictedPool, tenantA, (client) =>
        client.query(
          `insert into conversation_thread_access_grants (
             tenant_id, thread_id, user_id, scope, granted_by_user_id, granted_at
           ) values ($1, $2, $3, 'team', $4, $5)`,
          [tenantA, threadA, ownerB, ownerA, timestamp],
        ),
        ownerA,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      withTenantContext(restrictedPool, tenantA, (client) =>
        client.query(
          `insert into conversation_thread_access_grants (
             tenant_id, thread_id, user_id, scope, granted_by_user_id, granted_at
           ) values ($1, $2, $3, 'team', $4, $5)`,
          [tenantA, threadA, memberA, memberA, timestamp],
        ),
        memberA,
      ),
    ).rejects.toThrow(/row-level security|violates/i);
    await withTenantContext(restrictedPool, tenantA, (client) =>
      client.query(
        `insert into conversation_thread_access_grants (
           tenant_id, thread_id, user_id, scope, granted_by_user_id, granted_at
         ) values ($1, $2, $3, 'team', $4, $5)`,
        [tenantA, threadA, memberA, ownerA, timestamp],
      ),
      ownerA,
    );

    const immutableOperationId = `operation_owner_${unique}`;
    await withTenantContext(restrictedPool, tenantA, (client) =>
      client.query(
        `insert into conversation_thread_access_operations (
           id, tenant_id, thread_id, idempotency_key_hash, input_fingerprint,
           requested_by_user_id, visibility_scope, grant_count, configured_at
         ) values ($1, $2, $3, $4, $5, $6, 'team', 2, $7)`,
        [
          immutableOperationId,
          tenantA,
          threadA,
          "e".repeat(64),
          "f".repeat(64),
          ownerA,
          timestamp,
        ],
      ),
      ownerA,
    );
    const operationUpdate = await withTenantContext(
      restrictedPool,
      tenantA,
      (client) => client.query(
        `update conversation_thread_access_operations
         set grant_count = 99 where id = $1 returning id`,
        [immutableOperationId],
      ),
      ownerA,
    );
    expect(operationUpdate.rows).toEqual([]);
    const operationDelete = await withTenantContext(
      restrictedPool,
      tenantA,
      (client) => client.query(
        `delete from conversation_thread_access_operations
         where id = $1 returning id`,
        [immutableOperationId],
      ),
      ownerA,
    );
    expect(operationDelete.rows).toEqual([]);
  });
});

async function createRestrictedRole(ownerPool: Pool) {
  if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
  const roleName = `tradikom_thread_grant_${randomUUID().replaceAll("-", "")}`;
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
  actorId?: string,
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    if (actorId) {
      await client.query("select set_config('app.actor_id', $1, true)", [actorId]);
    }
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
