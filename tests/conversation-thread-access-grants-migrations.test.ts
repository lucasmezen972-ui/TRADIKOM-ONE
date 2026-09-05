import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { getMigrationIds, migrate } from "../src/lib/db";

const opened: PGlite[] = [];
const timestamp = "2026-09-04T20:25:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migrations des autorisations durables de fil", () => {
  it("garde les migrations runtime et leurs miroirs SQL identiques", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    const grants = readFileSync(
      new URL(
        "../src/db/migrations/0106_os5_conversation_thread_access_grants.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const rls = readFileSync(
      new URL(
        "../src/db/migrations/0107_os5_conversation_thread_access_grants_rls.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(
      extractSqlTemplate(runtime, "os5ConversationThreadAccessGrantsMigrationSql").trim(),
    ).toBe(grants.trim());
    expect(
      extractSqlTemplate(runtime, "os5ConversationThreadAccessGrantsRlsMigrationSql").trim(),
    ).toBe(rls.trim());
    expect(getMigrationIds()).toContain(
      "112_os5_conversation_thread_access_grants",
    );
    expect(getMigrationIds(true)).toContain(
      "113_os5_conversation_thread_access_grants_rls",
    );
  });

  it("met à niveau une base existante et impose portée, membership et idempotence", async () => {
    const db = new PGlite();
    opened.push(db);
    await migrate(db, {
      targetMigrationId: "111_os5_conversation_thread_access_classification",
    });
    await db.query(
      `insert into users (id, name, email, password_hash, created_at)
       values
         ('user_grant_a', 'Utilisateur A', 'grant-a@example.com', 'hash', $1),
         ('user_grant_b', 'Utilisateur B', 'grant-b@example.com', 'hash', $1)`,
      [timestamp],
    );
    await db.query(
      `insert into tenants (id, name, slug, category, created_at)
       values
         ('tenant_grant_a', 'Organisation A', 'tenant-grant-a', 'Services', $1),
         ('tenant_grant_b', 'Organisation B', 'tenant-grant-b', 'Services', $1)`,
      [timestamp],
    );
    await db.query(
      `insert into memberships (tenant_id, user_id, role, created_at)
       values
         ('tenant_grant_a', 'user_grant_a', 'owner', $1),
         ('tenant_grant_b', 'user_grant_b', 'owner', $1)`,
      [timestamp],
    );
    await db.query(
      `insert into conversation_threads (
         id, tenant_id, status, subject, confidentiality_level,
         visibility_scope, created_at, updated_at
       ) values (
         'thread_grant_a', 'tenant_grant_a', 'open', null, 'restricted',
         'team', $1, $1
       )`,
      [timestamp],
    );

    await migrate(db);
    await db.query(
      `insert into conversation_thread_access_grants (
         tenant_id, thread_id, user_id, scope, granted_by_user_id, granted_at
       ) values (
         'tenant_grant_a', 'thread_grant_a', 'user_grant_a', 'team',
         'user_grant_a', $1
       )`,
      [timestamp],
    );
    await expect(
      db.query(
        `insert into conversation_thread_access_grants (
           tenant_id, thread_id, user_id, scope, granted_by_user_id, granted_at
         ) values (
           'tenant_grant_a', 'thread_grant_a', 'user_grant_b', 'team',
           'user_grant_a', $1
         )`,
        [timestamp],
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      db.query(
        `update conversation_thread_access_grants
         set scope = 'tenant'
         where tenant_id = 'tenant_grant_a' and thread_id = 'thread_grant_a'`,
      ),
    ).rejects.toThrow(/check constraint|violates/i);

    await db.query(
      `insert into conversation_thread_access_operations (
         id, tenant_id, thread_id, idempotency_key_hash, input_fingerprint,
         requested_by_user_id, visibility_scope, grant_count, configured_at
       ) values (
         'operation_grant_a', 'tenant_grant_a', 'thread_grant_a', $1, $2,
         'user_grant_a', 'team', 1, $3
       )`,
      ["a".repeat(64), "b".repeat(64), timestamp],
    );
    await expect(
      db.query(
        `insert into conversation_thread_access_operations (
           id, tenant_id, thread_id, idempotency_key_hash, input_fingerprint,
           requested_by_user_id, visibility_scope, grant_count, configured_at
         ) values (
           'operation_grant_replay', 'tenant_grant_a', 'thread_grant_a', $1,
           $2, 'user_grant_a', 'case', 1, $3
         )`,
        ["a".repeat(64), "c".repeat(64), timestamp],
      ),
    ).rejects.toThrow(/unique constraint|duplicate key|violates/i);
  });
});

function extractSqlTemplate(source: string, constant: string) {
  const prefix = `const ${constant} = \``;
  const start = source.indexOf(prefix);
  if (start < 0) throw new Error(`Migration runtime absente : ${constant}.`);
  const sqlStart = start + prefix.length;
  const sqlEnd = source.indexOf("`;", sqlStart);
  if (sqlEnd < 0) throw new Error(`Migration runtime invalide : ${constant}.`);
  return source.slice(sqlStart, sqlEnd);
}
