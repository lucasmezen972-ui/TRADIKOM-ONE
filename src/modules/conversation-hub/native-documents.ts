import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Worker } from "node:worker_threads";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { z } from "zod";
import type { DbClient } from "@/lib/db";
import { withTenantSystemDbTransaction } from "@/db/tenant-context";
import { hashToken, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { assertTenantAccess, lockMembershipRole } from "@/modules/tenants";
import { ingestWebChannelMessage, webChannelMessageSchema, type WebChannelMessage } from "@/modules/channels/web-channel";
import { findAccessibleConversationThreadRow, lockConversationThreadRow } from "./repository";
import { prepareExternalUntrustedDataView } from "./external-untrusted-data";

export const maximumDocumentBytes = 512 * 1024;
const writeRoles = ["owner", "administrator", "manager", "collaborator"] as const;
const fileNameSchema = z.string().trim().min(1).max(180).regex(/^[^/\\\x00-\x1f\x7f]+\.(?:txt|csv|pdf)$/i);
const keySchema = z.string().min(32).max(4096);
const versionSchema = z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export class NativeDocumentError extends Error {
  readonly code = "conversation_document_unavailable";
  constructor() { super("Document indisponible. Utilisez un fichier TXT, CSV ou PDF contenant du texte, de 512 Ko maximum, et vérifiez votre accès au fil."); this.name = "NativeDocumentError"; }
}
type Keys = { keyMaterial: string; keyVersion: string };
type ObjectRow = { attachment_id: string; tenant_id: string; request_fingerprint: string; envelope: string; key_version: string; size_bytes: number };

export function configuredDocumentKeys(environment: Record<string, string | undefined> = process.env): Keys | null {
  const material = keySchema.safeParse(environment.CONNECTOR_ENCRYPTION_KEY);
  const version = versionSchema.safeParse(environment.CONNECTOR_ENCRYPTION_KEY_VERSION ?? "v1");
  return material.success && version.success ? { keyMaterial: material.data, keyVersion: version.data } : null;
}

export async function extractNativeDocument(fileName: string, bytes: Uint8Array) {
  if (!fileNameSchema.safeParse(fileName).success || !bytes.byteLength || bytes.byteLength > maximumDocumentBytes) throw new NativeDocumentError();
  const pdf = fileName.toLowerCase().endsWith(".pdf");
  let text: string;
  if (pdf) {
    if (Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") throw new NativeDocumentError();
    text = await new Promise<string>((resolve, reject) => {
      const worker = new Worker(path.join(process.cwd(), "src/modules/conversation-hub/pdf-text-worker.mjs"), {
        workerData: bytes, resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      });
      const timer = setTimeout(() => { void worker.terminate(); reject(new NativeDocumentError()); }, 8000);
      const done = () => { clearTimeout(timer); void worker.terminate(); };
      worker.once("message", (result: { ok?: boolean; text?: string }) => {
        done(); if (result.ok === true && typeof result.text === "string" && result.text.trim()) resolve(result.text.slice(0, 16000));
        else reject(new NativeDocumentError());
      });
      worker.once("error", () => { done(); reject(new NativeDocumentError()); });
      worker.once("exit", (code) => { clearTimeout(timer); if (code !== 0) reject(new NativeDocumentError()); });
    });
  } else {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new NativeDocumentError(); }
    if (!text.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) || /^(?:MZ|%PDF-|PK\x03\x04)/.test(text)) throw new NativeDocumentError();
    text = text.slice(0, 16000);
  }
  // Store only a filtered, bounded data view in searchable plaintext. Original bytes remain encrypted.
  const extractedAt = nowIso();
  const extractorKey = pdf ? "native-pdf-text-v1" : "native-utf8-v1";
  const filtered = prepareExternalUntrustedDataView({ trustBoundary: "external_untrusted_data", mode: "native",
    extractorKey, integrity: "verified", text, extractedAt }).content;
  return { extractorKey, text: filtered, extractedAt, mediaType: pdf ? "application/pdf" : fileName.toLowerCase().endsWith(".csv") ? "text/csv" : "text/plain" };
}

export async function ingestNativeConversationDocument(db: DbClient, actorId: string, input: WebChannelMessage,
  file: { name: string; bytes: Uint8Array }, keys: Keys | null = configuredDocumentKeys()) {
  if (!keys) throw new NativeDocumentError();
  const parsed = webChannelMessageSchema.parse(input);
  const name = fileNameSchema.safeParse(file.name);
  if (!name.success || file.bytes.byteLength > maximumDocumentBytes || !file.bytes.byteLength) throw new NativeDocumentError();
  await transaction(db, parsed.tenantId, actorId, (tx) => authorize(tx, actorId, parsed.tenantId, parsed.threadId, true));
  const extraction = await extractNativeDocument(name.data, file.bytes);
  const digest = createHash("sha256").update(file.bytes).digest("hex");
  const attachmentId = `file_${hashToken(JSON.stringify([parsed.tenantId, actorId, parsed.idempotencyKey]))}`;
  const fingerprint = hashToken(JSON.stringify([digest, name.data, parsed.text, parsed.threadId ?? null, parsed.externalMessageId, parsed.correlationId, parsed.occurredAt]));
  const envelope = encryptDocument(file.bytes, keys, parsed.tenantId, attachmentId, digest);
  return transaction(db, parsed.tenantId, actorId, async (tx) => {
    await authorize(tx, actorId, parsed.tenantId, parsed.threadId, true);
    if ((tx as { __runtime?: string }).__runtime === "postgres") await tx.query("select pg_advisory_xact_lock(hashtextextended('tradikom_native_document_quota', 0))");
    const existing = (await tx.query<ObjectRow>("select * from conversation_file_objects where attachment_id = $1", [attachmentId])).rows[0];
    if (existing && existing.request_fingerprint !== fingerprint) throw new NativeDocumentError();
    if (!existing) {
      const quota = (await tx.query<{ total: string; tenant_total: string }>(`select coalesce(sum(size_bytes), 0) as total,
        coalesce(sum(size_bytes) filter (where tenant_id = $1), 0) as tenant_total from conversation_file_objects`, [parsed.tenantId])).rows[0];
      if (Number(quota.total) + file.bytes.byteLength > 100 * 1024 * 1024 || Number(quota.tenant_total) + file.bytes.byteLength > 10 * 1024 * 1024) throw new NativeDocumentError();
    }
    const result = await ingestWebChannelMessage(tx, actorId, parsed, [{ id: attachmentId, kind: "document", fileName: name.data,
      mediaType: extraction.mediaType, sizeBytes: file.bytes.byteLength, checksumSha256: digest,
      storageReference: `dbdoc:${parsed.tenantId}:${attachmentId}` }], {
      [attachmentId]: { trustBoundary: "external_untrusted_data", extractorMode: "native", extractorKey: extraction.extractorKey,
        text: extraction.text, textSha256: hashToken(extraction.text), extractedAt: extraction.extractedAt },
    });
    if (!existing) {
      await tx.query(`insert into conversation_file_objects (attachment_id, tenant_id, request_fingerprint, key_version, envelope, size_bytes, created_at)
        values ($1, $2, $3, $4, $5, $6, $7)`, [attachmentId, parsed.tenantId, fingerprint, keys.keyVersion, envelope, file.bytes.byteLength, nowIso()]);
      await recordAuditLog(tx, { tenantId: parsed.tenantId, actorId, action: "conversation.document.stored",
        targetType: "conversation_message_attachment", targetId: attachmentId, metadata: { storageMode: "native", extractorMode: "native", sizeBytes: file.bytes.byteLength } });
    }
    return result;
  });
}

export async function readNativeConversationDocument(db: DbClient, actorId: string, tenantId: string, attachmentId: string,
  keys: Keys | null = configuredDocumentKeys()) {
  if (!keys || !/^file_[a-f0-9]{64}$/.test(attachmentId)) throw new NativeDocumentError();
  return transaction(db, tenantId, actorId, async (tx) => {
    const row = (await tx.query<ObjectRow & { thread_id: string; file_name: string; media_type: string; checksum_sha256: string }>(`
      select o.*, a.file_name, a.media_type, a.checksum_sha256, m.thread_id from conversation_file_objects o
      join conversation_message_attachments a on a.id = o.attachment_id and a.tenant_id = o.tenant_id
      join conversation_messages m on m.id = a.message_id and m.tenant_id = a.tenant_id
      where o.attachment_id = $1 and o.tenant_id = $2`, [attachmentId, tenantId])).rows[0];
    if (!row) throw new NativeDocumentError();
    await authorize(tx, actorId, tenantId, row.thread_id, false);
    const bytes = decryptDocument(row.envelope, keys, tenantId, attachmentId, row.checksum_sha256);
    if (bytes.length !== row.size_bytes || bytes.length > maximumDocumentBytes || createHash("sha256").update(bytes).digest("hex") !== row.checksum_sha256) throw new NativeDocumentError();
    await recordAuditLog(tx, { tenantId, actorId, action: "conversation.attachment_access_served", targetType: "conversation_message_attachment",
      targetId: attachmentId, metadata: { storageMode: "native", contentStoredInAudit: false } });
    return { bytes, fileName: row.file_name, mediaType: row.media_type };
  });
}

function encryptionKey(keys: Keys) {
  return createHash("sha256").update(JSON.stringify(["tradikom-native-document-v1", versionSchema.parse(keys.keyVersion), keySchema.parse(keys.keyMaterial)])).digest();
}
function aad(tenantId: string, id: string, digest: string) { return Buffer.from(JSON.stringify(["tradikom-native-document-v1", tenantId, id, digest])); }
export function encryptDocument(bytes: Uint8Array, keys: Keys, tenantId: string, id: string, digest: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(keys), iv); cipher.setAAD(aad(tenantId, id, digest));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return JSON.stringify({ version: 1, keyVersion: keys.keyVersion, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") });
}
export function decryptDocument(envelope: string, keys: Keys, tenantId: string, id: string, digest: string) {
  try {
    if (envelope.length > 710000) throw new Error();
    const e = z.object({ version: z.literal(1), keyVersion: z.literal(keys.keyVersion), iv: z.string().length(16), tag: z.string().length(24), data: z.string().min(1).max(700000) }).strict().parse(JSON.parse(envelope));
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(keys), Buffer.from(e.iv, "base64"));
    decipher.setAAD(aad(tenantId, id, digest)); decipher.setAuthTag(Buffer.from(e.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(e.data, "base64")), decipher.final()]);
  } catch { throw new NativeDocumentError(); }
}
async function authorize(db: DbClient, actorId: string, tenantId: string, threadId: string | undefined, write: boolean) {
  await assertTenantAccess(db, actorId, tenantId, write ? [...writeRoles] : undefined);
  const role = await lockMembershipRole(db, actorId, tenantId);
  const user = await db.query("select id from users where id = $1 and deleted_at is null for share", [actorId]);
  if (!role || !user.rows[0] || (write && !writeRoles.some(r => r === role))) throw new NativeDocumentError();
  if (threadId) {
    const thread = await lockConversationThreadRow(db, tenantId, threadId);
    if (!thread || (write && thread.status === "archived") || !await findAccessibleConversationThreadRow(db, tenantId, actorId, threadId)) throw new NativeDocumentError();
  }
}
async function transaction<T>(db: DbClient, tenantId: string, actorId: string, callback: (db: DbClient) => Promise<T>): Promise<T> {
  const client = db as DbClient & { __transaction?: boolean; transaction?: PGlite["transaction"] };
  if (!client.__transaction && client.transaction) return client.transaction(tx => callback({ __transaction: true, query: (sql: string, params?: unknown[]) => tx.query(sql, params) } as DbClient));
  return withTenantSystemDbTransaction(db, tenantId, actorId, callback);
}
