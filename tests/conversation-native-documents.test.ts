import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { createMemoryDb, migrate } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { configureConversationThreadAccess, getConversationThread } from "../src/modules/conversation-hub/service";
import { decryptDocument, encryptDocument, extractNativeDocument, ingestNativeConversationDocument, readNativeConversationDocument } from "../src/modules/conversation-hub/native-documents";
const keys = { keyMaterial: "fixture-private-document-encryption-2026", keyVersion: "fixture-v1" };
const opened: Awaited<ReturnType<typeof createMemoryDb>>[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(db => db.close())); });

it("chiffre les octets et refuse permutation de tenant, d’objet, de hash ou de clé", () => {
  const bytes = Buffer.from("Bonjour document privé");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const sealed = encryptDocument(bytes, keys, "tenant_a", "file_a", digest);
  expect(sealed).not.toContain("Bonjour");
  expect(decryptDocument(sealed, keys, "tenant_a", "file_a", digest)).toEqual(bytes);
  for (const [tenant, id, hash] of [["tenant_b", "file_a", digest], ["tenant_a", "file_b", digest], ["tenant_a", "file_a", "0".repeat(64)]]) {
    expect(() => decryptDocument(sealed, keys, tenant, id, hash)).toThrow();
  }
  expect(() => decryptDocument(sealed, { ...keys, keyMaterial: "different-key-material-for-fixture-only" }, "tenant_a", "file_a", digest)).toThrow();
});
it("extrait le texte UTF-8 en masquant secrets et liens, refuse binaires et limites", async () => {
  const text = await extractNativeDocument("notes.txt", Buffer.from("Texte utile\npassword=secret-value https://example.test/x"));
  expect(text.text).toContain("Texte utile"); expect(text.text).not.toContain("secret-value"); expect(text.text).not.toContain("example.test");
  for (const [name, bytes] of [["bad.txt", Buffer.from([255, 254])], ["bad.txt", Buffer.from("MZexecutable")], ["bad.pdf", Buffer.from("not pdf")], ["huge.txt", Buffer.alloc(524289)], ["../bad.txt", Buffer.from("test")]] as const) {
    await expect(extractNativeDocument(name, bytes)).rejects.toThrow();
  }
});
it("lit réellement un PDF texte isolé et refuse le PDF malformé", async () => {
  const pdf = textPdf();
  const result = await extractNativeDocument("document.pdf", Buffer.from(pdf));
  expect(result.text).toContain("Bonjour PDF texte"); expect(result.extractorKey).toBe("native-pdf-text-v1");
  await expect(extractNativeDocument("broken.pdf", Buffer.from("%PDF-1.4\nbroken"))).rejects.toThrow();
}, 20000);
it.each([false, true])("extrait le PDF depuis un bundle sans résolution CommonJS (exports ESM : %s)", async (importOnly) => {
  const directory = await mkdtemp(path.join(tmpdir(), "tradikom-pdf-bundle-"));
  let worker: Worker | undefined;
  try {
    const root = path.resolve(path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.mjs")), "../..");
    const bundle = path.join(directory, "node_modules/pdfjs-dist");
    await mkdir(bundle, { recursive: true });
    // Model a tracer keeping all runtime directories but omitting package.json.
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory()) await symlink(path.join(root, entry.name), path.join(bundle, entry.name), "dir");
    }
    if (importOnly) {
      await writeFile(path.join(bundle, "package.json"), JSON.stringify({ exports: { "./legacy/build/pdf.mjs": { import: "./legacy/build/pdf.mjs" } } }));
      expect(() => createRequire(path.join(directory, "worker.mjs")).resolve("pdfjs-dist/legacy/build/pdf.mjs")).toThrow();
    }
    await writeFile(path.join(directory, "worker.mjs"), await readFile(path.resolve("src/modules/conversation-hub/pdf-text-worker.mjs")));
    worker = new Worker(path.join(directory, "worker.mjs"), { workerData: { bytes: Buffer.from(textPdf()), assetsRoot: bundle } });
    const result = await new Promise<{ ok: boolean; text?: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("pdf_bundle_timeout")), 8000);
      worker!.once("message", result => { clearTimeout(timer); resolve(result); });
      worker!.once("error", error => { clearTimeout(timer); reject(error); });
    });
    expect(result).toMatchObject({ ok: true });
    expect(result.text).toContain("Bonjour PDF texte");
  } finally { await worker?.terminate(); await rm(directory, { recursive: true, force: true }); }
}, 15000);
function textPdf() {
  const stream = "BT /F1 12 Tf 50 100 Td (Bonjour PDF texte) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(pdf); pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return pdf;
}
it("stocke, extrait, télécharge sans doublon puis bloque le membre sans accès et le rôle lecture seule", async () => {
  const f = await fixture();
  const first = await ingestNativeConversationDocument(f.db, f.user.id, f.input, f.file, keys);
  const replay = await ingestNativeConversationDocument(f.db, f.user.id, f.input, f.file, keys);
  expect(replay).toMatchObject({ ...first, idempotentReplay: true });
  const thread = await getConversationThread(f.db, f.user.id, f.tenant.id, first.threadId);
  const attachment = thread.messages[0].attachments[0];
  expect(attachment.extraction).toMatchObject({ mode: "native", integrity: "verified", text: "Texte métier du document" });
  expect((await readNativeConversationDocument(f.db, f.user.id, f.tenant.id, attachment.id, keys)).bytes).toEqual(f.file.bytes);
  await expect(ingestNativeConversationDocument(f.db, f.user.id, f.input, { ...f.file, bytes: Buffer.from("autre texte") }, keys)).rejects.toThrow();
  expect((await f.db.query("select * from conversation_file_objects")).rows).toHaveLength(1);
  await configureConversationThreadAccess(f.db, f.user.id, { tenantId: f.tenant.id, threadId: first.threadId,
    visibilityScope: "personal", grantedUserIds: [f.user.id], idempotencyKey: "doc-access:private" });
  await expect(readNativeConversationDocument(f.db, f.member.id, f.tenant.id, attachment.id, keys)).rejects.toThrow();
  await migrate(f.db, { enableRls: true });
  await f.db.exec("create role document_rls_client; grant usage on schema public to document_rls_client; grant select, insert, update, delete on all tables in schema public to document_rls_client; set role document_rls_client");
  await f.db.query("select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false)", [f.tenant.id, f.member.id]);
  expect((await f.db.query("select * from conversation_file_objects")).rows).toHaveLength(0);
  expect((await f.db.query("select * from audit_logs where target_type = 'conversation_message_attachment'")).rows).toHaveLength(0);
  await f.db.exec("reset role");
  await f.db.query("update memberships set role = 'read-only' where tenant_id = $1 and user_id = $2", [f.tenant.id, f.user.id]);
  await expect(ingestNativeConversationDocument(f.db, f.user.id, { ...f.input, idempotencyKey: "docs:read-only" }, f.file, keys)).rejects.toThrow();
});
it("annule le message et l’objet chiffré si l’audit final échoue", async () => {
  const f = await fixture();
  await f.db.exec(`create function fail_document_audit() returns trigger language plpgsql as $$ begin
    if new.action = 'conversation.document.stored' then raise exception 'document_audit_failed'; end if; return new; end $$;
    create trigger fail_document_audit before insert on audit_logs for each row execute function fail_document_audit()`);
  await expect(ingestNativeConversationDocument(f.db, f.user.id, f.input, f.file, keys)).rejects.toThrow("document_audit_failed");
  expect((await f.db.query("select * from conversation_file_objects")).rows).toHaveLength(0);
  expect((await f.db.query("select * from conversation_messages")).rows).toHaveLength(0);
});
async function fixture() {
  const db = await createMemoryDb(); opened.push(db); const services = createServices(db);
  const user = await services.registerUser({ name: "Documents", email: "documents@example.test", password: "FixturePassword!1" });
  const member = await services.registerUser({ name: "Collègue", email: "documents-member@example.test", password: "FixturePassword!1" });
  const tenant = await services.createTenant(user.id, { name: "Entreprise documents", category: "Services" });
  await db.query("insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, 'collaborator', $3)", [tenant.id, member.id, new Date().toISOString()]);
  return { db, services, user, member, tenant, input: { tenantId: tenant.id, displayName: user.name,
    externalMessageId: "docs-source", idempotencyKey: "docs:source", correlationId: "docs:fixture", text: "Lire mon document", occurredAt: new Date().toISOString() },
  file: { name: "notes.txt", bytes: Buffer.from("Texte métier du document") } };
}
