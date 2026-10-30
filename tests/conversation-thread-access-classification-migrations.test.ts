import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { getMigrationIds, migrate } from "../src/lib/db";

const opened: PGlite[] = [];
const timestamp = "2026-09-04T19:30:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("classification d'accès des fils canoniques", () => {
  it("garde la migration runtime et son miroir SQL identiques", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    const mirror = readFileSync(
      new URL(
        "../src/db/migrations/0105_os5_conversation_thread_access_classification.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(
      extractSqlTemplate(
        runtime,
        "os5ConversationThreadAccessClassificationMigrationSql",
      ).trim(),
    ).toBe(mirror.trim());
    expect(getMigrationIds()).toContain(
      "111_os5_conversation_thread_access_classification",
    );
  });

  it("met à niveau les fils existants avec des valeurs sûres et contraintes", async () => {
    const db = new PGlite();
    opened.push(db);
    await migrate(db, { targetMigrationId: "110_os5_media_untrusted_extraction" });
    await db.query(
      `insert into tenants (id, name, slug, category, created_at)
       values ('tenant_access_upgrade', 'Organisation test',
         'tenant-access-upgrade', 'Services', $1)`,
      [timestamp],
    );
    await db.query(
      `insert into conversation_threads (
         id, tenant_id, status, subject, created_at, updated_at
       ) values (
         'thread_access_upgrade', 'tenant_access_upgrade', 'open', null, $1, $1
       )`,
      [timestamp],
    );

    await migrate(db);
    const upgraded = await db.query<{
      confidentiality_level: string;
      visibility_scope: string;
    }>(
      `select confidentiality_level, visibility_scope
       from conversation_threads where id = 'thread_access_upgrade'`,
    );
    expect(upgraded.rows).toEqual([{
      confidentiality_level: "internal",
      visibility_scope: "tenant",
    }]);

    await db.query(
      `update conversation_threads
       set confidentiality_level = 'restricted', visibility_scope = 'team'
       where id = 'thread_access_upgrade'`,
    );
    await expect(
      db.query(
        `update conversation_threads
         set confidentiality_level = 'private'
         where id = 'thread_access_upgrade'`,
      ),
    ).rejects.toThrow(/check constraint|violates/i);
    await expect(
      db.query(
        `update conversation_threads
         set visibility_scope = 'global'
         where id = 'thread_access_upgrade'`,
      ),
    ).rejects.toThrow(/check constraint|violates/i);
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
