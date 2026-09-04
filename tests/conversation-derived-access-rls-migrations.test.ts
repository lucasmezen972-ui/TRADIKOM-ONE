import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getMigrationIds } from "../src/lib/db";

describe("migration RLS des objets dérivés de Conversation", () => {
  it("garde la migration runtime et son miroir SQL identiques", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    const mirror = readFileSync(
      new URL(
        "../src/db/migrations/0108_os5_conversation_derived_access_rls.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const migration = extractSqlTemplate(
      runtime,
      "os5ConversationDerivedAccessRlsMigrationSql",
    );

    expect(migration.trim()).toBe(mirror.trim());
    expect(getMigrationIds()).not.toContain(
      "114_os5_conversation_derived_access_rls",
    );
    expect(getMigrationIds(true).at(-1)).toBe(
      "114_os5_conversation_derived_access_rls",
    );
  });

  it("reste SECURITY INVOKER et couvre chaque relation protégée", () => {
    const migration = readFileSync(
      new URL(
        "../src/db/migrations/0108_os5_conversation_derived_access_rls.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).not.toMatch(/security\s+definer/i);
    expect(migration.match(/security invoker/gi)).toHaveLength(6);
    for (const table of [
      "conversation_threads",
      "conversation_thread_participants",
      "conversation_messages",
      "conversation_message_attachments",
      "conversation_message_route_hops",
      "conversation_action_plans",
      "conversation_action_plan_steps",
      "workflow_runs",
      "workflow_run_steps",
      "approvals",
      "domain_events",
    ]) {
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain("for select to public");
    expect(migration).toContain("for insert to public");
    expect(migration).toContain("for update to public");
    expect(migration).toContain("for delete to public");
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
