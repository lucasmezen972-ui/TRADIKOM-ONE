import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, getMigrationIds } from "../src/lib/db";

const opened: Array<{ close: () => Promise<void> }> = [];
const timestamp = "2026-09-02T20:30:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migrations des réservations d'import média fournisseur", () => {
  it("garde les migrations runtime et SQL miroir identiques", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    const definitions = [
      [
        "os5ChannelProviderMediaImportsMigrationSql",
        "../src/db/migrations/0099_os5_channel_provider_media_imports.sql",
      ],
      [
        "os5ChannelProviderMediaImportsRlsMigrationSql",
        "../src/db/migrations/0100_os5_channel_provider_media_imports_rls.sql",
      ],
      [
        "os5ChannelProviderMediaImportExecutionsMigrationSql",
        "../src/db/migrations/0101_os5_channel_provider_media_import_executions.sql",
      ],
      [
        "os5ChannelProviderMediaImportExecutionsRlsMigrationSql",
        "../src/db/migrations/0102_os5_channel_provider_media_import_executions_rls.sql",
      ],
    ] as const;
    for (const [constant, mirrorPath] of definitions) {
      const mirror = readFileSync(new URL(mirrorPath, import.meta.url), "utf8");
      expect(extractSqlTemplate(runtime, constant).trim()).toBe(mirror.trim());
    }
    expect(getMigrationIds()).toContain(
      "105_os5_channel_provider_media_imports",
    );
    expect(getMigrationIds(true)).toContain(
      "106_os5_channel_provider_media_imports_rls",
    );
    expect(getMigrationIds()).toContain(
      "107_os5_channel_provider_media_import_executions",
    );
    expect(getMigrationIds(true)).toContain(
      "108_os5_channel_provider_media_import_executions_rls",
    );
  });

  it("ne crée aucune colonne fournisseur sensible en clair", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const forbidden = await db.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'channel_provider_media_imports'
         and column_name in (
           'media_id', 'provider_media_id', 'mime_type', 'media_type',
           'checksum', 'checksum_sha256', 'file_name', 'filename', 'url',
           'content', 'payload', 'raw_payload'
         )`,
    );
    expect(forbidden.rows).toEqual([]);
  });

  it("impose tenant, provider, idempotence, états cohérents et immutabilité", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await seedContext(db, "a");
    await seedContext(db, "b");
    await insertPendingReservation(db, "reservation_a", "tenant_a", "endpoint_a", "message_a");

    await expect(
      insertPendingReservation(
        db,
        "reservation_cross",
        "tenant_a",
        "endpoint_b",
        "message_b",
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      insertPendingReservation(
        db,
        "reservation_duplicate",
        "tenant_a",
        "endpoint_a",
        "message_a",
      ),
    ).rejects.toThrow(/unique|duplicate/i);
    await expect(
      db.query(
        `insert into channel_provider_media_imports (
           id, tenant_id, provider, endpoint_id, message_id, media_kind,
           reservation_status, encrypted_provider_reference, key_version,
           request_fingerprint, safe_error_code, created_at, updated_at
         ) values (
           'reservation_invalid', 'tenant_a', 'whatsapp_meta', 'endpoint_a',
           'message_a', 'document', 'pending', null, null, $1, null, $2, $2
         )`,
        ["d".repeat(64), timestamp],
      ),
    ).rejects.toThrow(/check constraint|violates/i);
    await expect(
      db.query(
        `update channel_provider_media_imports
         set reservation_status = 'failed',
             encrypted_provider_reference = null,
             key_version = null,
             safe_error_code = 'media_reference_encryption_failed',
             updated_at = $1
         where tenant_id = 'tenant_a' and id = 'reservation_a'`,
        [timestamp],
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it("journalise l'exécution sans octets ni référence fournisseur et protège son identité", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await seedContext(db, "a");
    await seedContext(db, "b");
    await insertPendingReservation(
      db,
      "reservation_a",
      "tenant_a",
      "endpoint_a",
      "message_a",
    );
    await db.query(
      `insert into channel_provider_media_import_executions (
         id, tenant_id, media_import_id, provider, provider_mode, storage_mode,
         status, failure_classification, safe_error_code, retryable, attempts,
         max_attempts, next_attempt_at, last_attempted_at, lease_id,
         lease_expires_at, attachment_id, created_by, created_at, updated_at
       ) values (
         'execution_a', 'tenant_a', 'reservation_a', 'whatsapp_meta',
         'mock', 'mock', 'reserved', null, null, null, 0, 3, $1,
         null, null, null, null, 'user_a', $1, $1
       )`,
      [timestamp],
    );
    const forbidden = await db.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'channel_provider_media_import_executions'
         and column_name in (
           'bytes', 'content', 'payload', 'raw_payload', 'provider_reference',
           'encrypted_provider_reference', 'storage_reference', 'checksum_sha256',
           'file_name', 'media_type'
         )`,
    );
    expect(forbidden.rows).toEqual([]);
    await expect(
      db.query(
        `update channel_provider_media_import_executions
         set provider_mode = 'disabled'
         where tenant_id = 'tenant_a' and id = 'execution_a'`,
      ),
    ).rejects.toThrow(/identity_immutable/i);
    await expect(
      db.query(
        `insert into channel_provider_media_import_executions (
           id, tenant_id, media_import_id, provider, provider_mode, storage_mode,
           status, failure_classification, safe_error_code, retryable, attempts,
           max_attempts, next_attempt_at, last_attempted_at, lease_id,
           lease_expires_at, attachment_id, created_by, created_at, updated_at
         ) values (
           'execution_cross', 'tenant_b', 'reservation_a', 'whatsapp_meta',
           'mock', 'mock', 'reserved', null, null, null, 0, 3, $1,
           null, null, null, null, 'user_b', $1, $1
         )`,
        [timestamp],
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function seedContext(db: TestDb, suffix: "a" | "b") {
  const userId = `user_${suffix}`;
  const tenantId = `tenant_${suffix}`;
  const participantId = `participant_${suffix}`;
  const identityId = `identity_${suffix}`;
  const threadId = `thread_${suffix}`;
  await db.query(
    `insert into users (id, name, email, password_hash, created_at)
     values ($1, $2, $3, 'hash', $4)`,
    [userId, `Utilisateur ${suffix}`, `${userId}@example.test`, timestamp],
  );
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ($1, $2, $1, 'Services', $3)`,
    [tenantId, `Organisation ${suffix}`, timestamp],
  );
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ($1, $2, 'customer', null, $3, $3)`,
    [participantId, tenantId, timestamp],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values (
       $1, $2, $3, 'messaging', 'whatsapp-meta', $4, null,
       'customer', 'active', $5, $5
     )`,
    [identityId, tenantId, participantId, `meta_subject_${suffix}`, timestamp],
  );
  await db.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, created_at, updated_at, last_message_at
     ) values ($1, $2, 'open', null, $3, $3, $3)`,
    [threadId, tenantId, timestamp],
  );
  await db.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, causation_id, safe_error_code, occurred_at, created_at
     ) values (
       $1, $2, $3, $4, 'inbound', 'text', 'received', 'Média en attente',
       'whatsapp-meta', $5, $6, $7, null, null, $8, $8
     )`,
    [
      `message_${suffix}`,
      tenantId,
      threadId,
      identityId,
      `wamid.media_${suffix}`,
      `media-message-idempotency-${suffix}`,
      `media-message-correlation-${suffix}`,
      timestamp,
    ],
  );
  await db.query(
    `insert into channel_provider_endpoints (
       id, tenant_id, provider, external_account_id,
       destination_fingerprint, status, created_by, created_at, updated_at
     ) values ($1, $2, 'whatsapp_meta', $3, $4, 'active', $5, $6, $6)`,
    [
      `endpoint_${suffix}`,
      tenantId,
      suffix === "a" ? "123456789" : "987654321",
      suffix.repeat(64),
      userId,
      timestamp,
    ],
  );
}

function insertPendingReservation(
  db: TestDb,
  id: string,
  tenantId: string,
  endpointId: string,
  messageId: string,
) {
  return db.query(
    `insert into channel_provider_media_imports (
       id, tenant_id, provider, endpoint_id, message_id, media_kind,
       reservation_status, encrypted_provider_reference, key_version,
       request_fingerprint, safe_error_code, created_at, updated_at
     ) values (
       $1, $2, 'whatsapp_meta', $3, $4, 'document', 'pending', $5,
       'media-test-v1', $6, null, $7, $7
     )`,
    [
      id,
      tenantId,
      endpointId,
      messageId,
      `encrypted-${"x".repeat(80)}`,
      "c".repeat(64),
      timestamp,
    ],
  );
}

function extractSqlTemplate(source: string, constant: string) {
  const prefix = `const ${constant} = \``;
  const start = source.indexOf(prefix);
  if (start < 0) throw new Error(`Migration runtime absente : ${constant}.`);
  const sqlStart = start + prefix.length;
  const sqlEnd = source.indexOf("`;", sqlStart);
  if (sqlEnd < 0) throw new Error(`Migration runtime invalide : ${constant}.`);
  return source.slice(sqlStart, sqlEnd);
}
