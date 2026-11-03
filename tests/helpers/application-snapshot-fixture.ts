import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { PGlite } from "@electric-sql/pglite";

const run = promisify(execFile);
const project = path.resolve(import.meta.dirname, "../..");

export type ApplicationSnapshot = {
  format_version: number;
  schemas?: { name: string; owner: string; acl: unknown[] }[];
  schema_acl?: unknown[];
  tables: { schema?: string; name: string; data_xml: string; [key: string]: unknown }[];
  functions: { schema?: string; identity: string; [key: string]: unknown }[];
  roles: { name: string; config: string[]; [key: string]: unknown }[];
  [key: string]: unknown;
};

export async function captureFixtureSnapshot(db: PGlite) {
  const sql = await readFile(path.join(project, "scripts/export-application-snapshot.sql"), "utf8");
  const result = await db.query<{ snapshot: ApplicationSnapshot }>(sql);
  return result.rows[0]!.snapshot;
}

export async function prepareFixtureKit(snapshot: unknown) {
  const root = await mkdtemp(path.join(tmpdir(), "tradikom-fixture-restore-"));
  const input = path.join(root, "fictitious-snapshot.json");
  const kit = path.join(root, "kit");
  await writeFile(input, JSON.stringify(snapshot), { mode: 0o600 });
  try {
    await run("python3", [path.join(project, "scripts/prepare-application-restore.py"), input, kit]);
    return {
      root, kit,
      sql: await readFile(path.join(kit, "restore_application.sql"), "utf8"),
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyFixtureKit(kit: string) {
  const { stdout } = await run(process.execPath, [path.join(project, "scripts/verify-application-snapshot.mjs"), kit], { maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout) as Record<string, unknown>;
}
