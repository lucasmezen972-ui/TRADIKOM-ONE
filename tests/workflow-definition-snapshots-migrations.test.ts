import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, getMigrationIds } from "../src/lib/db";
import { toJson } from "../src/lib/security";
import { workflowDefinitionSchema } from "../src/modules/workflows";

const opened: Array<{ close: () => Promise<void> }> = [];
const timestamp = "2026-08-03T04:30:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migrations des snapshots de mission OS-4", () => {
  it("garde la migration runtime et son miroir SQL identiques", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    const mirror = readFileSync(
      new URL(
        "../src/db/migrations/0081_os4_workflow_definition_snapshots.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(
      extractSqlTemplate(runtime, "os4WorkflowDefinitionSnapshotsMigrationSql").trim(),
    ).toBe(mirror.trim());
    expect(getMigrationIds()).toContain("087_os4_workflow_definition_snapshots");
  });

  it("conserve un snapshot borné et interdit sa mutation", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await db.query(
      `insert into tenants (id, name, slug, category, created_at)
       values ('tenant_snapshot', 'Organisation snapshot', 'tenant-snapshot', 'Services', $1)`,
      [timestamp],
    );
    const definition = workflowDefinitionSchema.parse({
      key: "conversation_plan:snapshot_migration",
      version: 3,
      trigger: "conversation.plan.execute",
      active: true,
      conditions: [],
      actions: [{ type: "mock_search_contact", input: {} }],
      retryPolicy: { maxAttempts: 3, backoffMs: 0 },
      timeoutMs: 30_000,
      approvalPolicy: "no_approval_required",
    });
    await db.query(
      `insert into workflow_runs (
         id, tenant_id, workflow_key, trigger_name, status, summary, error,
         retry_count, definition_snapshot, definition_version, created_at
       ) values ($1, $2, $3, $4, 'running', 'Mission en cours.', null, 0, $5, $6, $7)`,
      [
        "run_snapshot",
        "tenant_snapshot",
        definition.key,
        definition.trigger,
        toJson(definition),
        definition.version,
        timestamp,
      ],
    );

    await expect(
      db.query(
        `update workflow_runs
         set definition_version = 4
         where tenant_id = 'tenant_snapshot' and id = 'run_snapshot'`,
      ),
    ).rejects.toThrow(/snapshot_immutable/i);
    await expect(
      db.query(
        `insert into workflow_runs (
           id, tenant_id, workflow_key, trigger_name, status, summary, error,
           retry_count, definition_snapshot, definition_version, created_at
         ) values (
           'run_snapshot_incomplete', 'tenant_snapshot', 'conversation_plan:bad',
           'conversation.plan.execute', 'running', 'Mission invalide.', null,
           0, '{}', null, $1
         )`,
        [timestamp],
      ),
    ).rejects.toThrow(/check constraint|violates/i);
  });
});

function extractSqlTemplate(source: string, constant: string) {
  const prefix = "const " + constant + " = `";
  const start = source.indexOf(prefix);
  if (start < 0) throw new Error(`Migration runtime absente : ${constant}.`);
  const sqlStart = start + prefix.length;
  const sqlEnd = source.indexOf("`;", sqlStart);
  if (sqlEnd < 0) throw new Error(`Migration runtime invalide : ${constant}.`);
  return source.slice(sqlStart, sqlEnd);
}
