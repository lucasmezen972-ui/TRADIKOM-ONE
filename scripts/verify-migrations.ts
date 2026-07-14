import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  getMigrationIds,
  migrate,
  type DbClient,
} from "../src/lib/db";

const phase2Target = "016_tenant_integrity";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for migration verification.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await verifyEmptyDatabase(client, databaseUrl);
    await verifyPhase2Upgrade(client, databaseUrl);
  } finally {
    await client.end();
  }

  process.stdout.write("Migration verification completed.\n");
}

async function verifyEmptyDatabase(adminClient: Client, databaseUrl: string) {
  await withTemporaryDatabase(
    adminClient,
    databaseUrl,
    "empty",
    async (db) => {
      await migrate(db, { enableRls: true });
      await migrate(db, { enableRls: true });
      await expectMigrationHistory(db, getMigrationIds(true));
      await expectTenantRlsCoverage(db);
      await expectTenantIndexes(db);
    },
  );
}

async function verifyPhase2Upgrade(adminClient: Client, databaseUrl: string) {
  await withTemporaryDatabase(
    adminClient,
    databaseUrl,
    "phase2",
    async (db) => {
      await migrate(db, {
        enableRls: true,
        targetMigrationId: phase2Target,
      });
      await db.query(
        `insert into users (id, name, email, password_hash, created_at)
       values ('migration-user', 'Migration User', 'migration@example.test',
         'non-production-fixture', '2026-01-01T00:00:00.000Z')`,
      );
      await db.query(
        `insert into tenants (id, name, slug, category, created_at)
       values ('migration-tenant', 'Migration Tenant', 'migration-tenant',
         'Services', '2026-01-01T00:00:00.000Z')`,
      );
      await db.query(
        `insert into memberships (tenant_id, user_id, role, created_at)
       values ('migration-tenant', 'migration-user', 'owner',
         '2026-01-01T00:00:00.000Z')`,
      );
      await db.query(
        `insert into contacts (
         id, tenant_id, name, email, phone, status, source, tags,
         assigned_user_id, created_at, updated_at
       ) values (
         'migration-contact', 'migration-tenant', 'Contact conservé',
         'contact@example.test', '+596696000000', 'active', 'migration', '[]',
         'migration-user', '2026-01-01T00:00:00.000Z',
         '2026-01-01T00:00:00.000Z'
       )`,
      );

      await migrate(db, { enableRls: true });
      await expectMigrationHistory(db, getMigrationIds(true));
      const preserved = await db.query<{ count: number | string }>(
        `select count(*)::int as count
       from contacts
       where tenant_id = 'migration-tenant' and id = 'migration-contact'`,
      );
      assert(
        Number(preserved.rows[0]?.count) === 1,
        "Phase 2 data did not survive the Phase 3 migration path.",
      );
    },
  );
}

async function expectMigrationHistory(db: DbClient, expected: string[]) {
  const result = await db.query<{ id: string }>(
    "select id from schema_migrations order by id asc",
  );
  const actual = result.rows.map((row) => row.id);
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    "Database migration history is incomplete or out of order.",
  );
}

async function expectTenantRlsCoverage(db: DbClient) {
  const gaps = await db.query<{ table_name: string }>(
    `select columns.table_name
     from information_schema.columns as columns
     join pg_class as tables on tables.relname = columns.table_name
     join pg_namespace as namespaces on namespaces.oid = tables.relnamespace
     where columns.table_schema = 'public'
       and columns.column_name = 'tenant_id'
       and namespaces.nspname = 'public'
       and (
         not tables.relrowsecurity
         or not exists (
           select 1 from pg_policies as policies
           where policies.schemaname = 'public'
             and policies.tablename = columns.table_name
             and policies.cmd = 'ALL'
         )
       )
     order by columns.table_name`,
  );
  assert(
    gaps.rows.length === 0,
    `Tenant RLS coverage is incomplete: ${gaps.rows.map((row) => row.table_name).join(", ")}.`,
  );
}

async function expectTenantIndexes(db: DbClient) {
  const gaps = await db.query<{ table_name: string }>(
    `select columns.table_name
     from information_schema.columns as columns
     where columns.table_schema = 'public'
       and columns.column_name = 'tenant_id'
       and not exists (
         select 1
         from pg_index as indexes
         join pg_class as tables on tables.oid = indexes.indrelid
         join pg_namespace as namespaces on namespaces.oid = tables.relnamespace
         join pg_attribute as attributes
           on attributes.attrelid = indexes.indrelid
          and attributes.attnum = indexes.indkey[0]
         where namespaces.nspname = 'public'
           and tables.relname = columns.table_name
           and attributes.attname = 'tenant_id'
       )
     order by columns.table_name`,
  );
  assert(
    gaps.rows.length === 0,
    `Tenant-leading indexes are missing: ${gaps.rows.map((row) => row.table_name).join(", ")}.`,
  );
}

async function withTemporaryDatabase(
  adminClient: Client,
  databaseUrl: string,
  label: string,
  run: (db: DbClient) => Promise<void>,
) {
  const databaseName = `migration_${label}_${randomUUID().replaceAll("-", "")}`;
  const identifier = quoteIdentifier(databaseName);
  await adminClient.query(`create database ${identifier}`);
  const targetUrl = new URL(databaseUrl);
  targetUrl.pathname = `/${databaseName}`;
  const client = new Client({ connectionString: targetUrl.toString() });
  try {
    await client.connect();
    await run(asDbClient(client));
  } finally {
    await client.end();
    await adminClient.query(`drop database if exists ${identifier} with (force)`);
  }
}

function asDbClient(client: Client): DbClient {
  return {
    query: async <T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ) => {
      const result = await client.query(sql, params);
      return {
        rows: result.rows as T[],
        affectedRows: result.rowCount ?? undefined,
      };
    },
  };
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Migration verification failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
