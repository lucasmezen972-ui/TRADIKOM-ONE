import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { createMemoryDb, migrate } from "../src/lib/db";
it("conserve les six miroirs SQL IA/documents/connecteur et rejoue le journal avec RLS", async () => {
  const source = await readFile("src/lib/db.ts", "utf8");
  for (const [file, constant] of [
    ["0121_conversation_model_requests.sql", "conversationModelRequestsMigrationSql"],
    ["0122_conversation_model_requests_rls.sql", "conversationModelRequestsRlsMigrationSql"],
    ["0123_conversation_native_documents.sql", "conversationNativeDocumentsMigrationSql"],
    ["0124_conversation_native_documents_rls.sql", "conversationNativeDocumentsRlsMigrationSql"],
    ["0125_github_public_connectors.sql", "githubPublicConnectorsMigrationSql"],
    ["0126_github_public_connectors_rls.sql", "githubPublicConnectorsRlsMigrationSql"],
    ["0127_conversation_task_proposals.sql", "conversationTaskProposalsMigrationSql"],
    ["0128_conversation_task_proposals_rls.sql", "conversationTaskProposalsRlsMigrationSql"],
  ]) {
    const sql = await readFile(`src/db/migrations/${file}`, "utf8");
    expect(source).toContain(`const ${constant} = \`\n${sql}\`;`);
  }
  const db = await createMemoryDb();
  try {
    await migrate(db, { enableRls: true }); await migrate(db, { enableRls: true });
    const journal = (await db.query<{ id: string }>("select id from schema_migrations")).rows.map(row => row.id);
    expect(new Set(journal).size).toBe(journal.length);
    expect(journal).toContain("132_github_public_connectors_rls");
    expect(journal).toContain("134_conversation_task_proposals_rls");
    for (const table of ["conversation_model_requests", "conversation_model_budget_charges", "conversation_file_objects", "github_public_connectors", "conversation_task_proposals"]) {
      expect((await db.query("select policyname from pg_policies where tablename = $1 and policyname = 'tenant_isolation'", [table])).rows).toHaveLength(0);
    }
  } finally { await db.close(); }
});
