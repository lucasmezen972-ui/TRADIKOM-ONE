import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, getMigrationIds } from "../src/lib/db";

const opened: Array<{ close: () => Promise<void> }> = [];
const timestamp = "2026-07-30T12:00:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migrations du Conversation Hub", () => {
  it("enregistre les migrations et crée uniquement le schéma canonique borné", async () => {
    expect(getMigrationIds()).toContain("067_os1_conversation_hub");
    expect(getMigrationIds(true)).toEqual(
      expect.arrayContaining([
        "067_os1_conversation_hub",
        "068_os1_conversation_hub_rls",
        "069_os1_conversation_action_plans",
        "070_os1_conversation_action_plans_rls",
      ]),
    );

    const db = await createMemoryDb();
    opened.push(db);
    const tables = await db.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name like 'conversation_%'
       order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "conversation_action_plan_steps",
      "conversation_action_plans",
      "conversation_channel_identities",
      "conversation_message_attachments",
      "conversation_message_route_hops",
      "conversation_messages",
      "conversation_participants",
      "conversation_thread_participants",
      "conversation_threads",
    ]);

    const unsafeColumns = await db.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name like 'conversation_%'
         and column_name in ('raw_payload', 'payload', 'content_blob', 'signed_url')`,
    );
    expect(unsafeColumns.rows).toEqual([]);
  });

  it("refuse les relations inter-tenant, les doublons d'entrée et les boucles", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await seedTenant(db, "tenant_a", "Tenant A");
    await seedTenant(db, "tenant_b", "Tenant B");
    await seedParticipant(db, "tenant_a", "participant_a");
    await seedParticipant(db, "tenant_b", "participant_b");
    await seedIdentity(db, "tenant_a", "identity_a", "participant_a", "visitor_a");
    await seedIdentity(db, "tenant_b", "identity_b", "participant_b", "visitor_b");
    await seedThread(db, "tenant_a", "thread_a");
    await seedThread(db, "tenant_b", "thread_b");

    await expect(
      seedIdentity(
        db,
        "tenant_a",
        "identity_cross_tenant",
        "participant_b",
        "visitor_cross_tenant",
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    await db.query(
      `insert into conversation_thread_participants (
         tenant_id, thread_id, channel_identity_id, joined_at
       ) values ($1, $2, $3, $4)`,
      ["tenant_a", "thread_a", "identity_a", timestamp],
    );
    await expect(
      db.query(
        `insert into conversation_thread_participants (
           tenant_id, thread_id, channel_identity_id, joined_at
         ) values ($1, $2, $3, $4)`,
        ["tenant_a", "thread_a", "identity_b", timestamp],
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    await seedMessage(db, "tenant_a", "message_a", "thread_a", "identity_a");
    await seedMessage(db, "tenant_b", "message_b", "thread_b", "identity_b");
    await expect(
      seedMessage(
        db,
        "tenant_a",
        "message_duplicate",
        "thread_a",
        "identity_a",
      ),
    ).rejects.toThrow(/unique|duplicate/i);

    await db.query(
      `insert into conversation_message_attachments (
         id, tenant_id, message_id, kind, file_name, media_type, size_bytes,
         storage_reference, checksum_sha256, created_at
       ) values ($1, $2, $3, 'document', 'demande.pdf', 'application/pdf',
         1024, $4, $5, $6)`,
      [
        "attachment_a",
        "tenant_a",
        "message_a",
        "tenant_a/conversations/attachment_a",
        "a".repeat(64),
        timestamp,
      ],
    );
    await expect(
      db.query(
        `insert into conversation_message_attachments (
           id, tenant_id, message_id, kind, file_name, media_type, size_bytes,
           storage_reference, checksum_sha256, created_at
         ) values ($1, $2, $3, 'file', 'trop-grand.bin',
           'application/octet-stream', 26214401, $4, $5, $6)`,
        [
          "attachment_too_large",
          "tenant_a",
          "message_a",
          "tenant_a/conversations/attachment_too_large",
          "b".repeat(64),
          timestamp,
        ],
      ),
    ).rejects.toThrow(/check constraint|violates/i);

    await db.query(
      `insert into conversation_message_route_hops (
         tenant_id, message_id, position, adapter_key, channel_identity_id,
         external_message_id
       ) values ($1, $2, 0, 'canal-test', $3, 'external_message_a')`,
      ["tenant_a", "message_a", "identity_a"],
    );
    await expect(
      db.query(
        `insert into conversation_message_route_hops (
           tenant_id, message_id, position, adapter_key, channel_identity_id,
           external_message_id
         ) values ($1, $2, 1, 'canal-test', $3, 'external_message_a_replay')`,
        ["tenant_a", "message_a", "identity_a"],
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function seedTenant(db: TestDb, tenantId: string, name: string) {
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ($1, $2, $3, 'Services', $4)`,
    [tenantId, name, tenantId, timestamp],
  );
}

async function seedParticipant(
  db: TestDb,
  tenantId: string,
  participantId: string,
) {
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ($1, $2, 'customer', 'Cliente test', $3, $3)`,
    [participantId, tenantId, timestamp],
  );
}

async function seedIdentity(
  db: TestDb,
  tenantId: string,
  identityId: string,
  participantId: string,
  externalSubjectId: string,
) {
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values ($1, $2, $3, 'test', 'canal-test', $4, 'Cliente test',
       'customer', 'active', $5, $5)`,
    [identityId, tenantId, participantId, externalSubjectId, timestamp],
  );
}

async function seedThread(db: TestDb, tenantId: string, threadId: string) {
  await db.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, created_at, updated_at
     ) values ($1, $2, 'open', 'Demande de devis', $3, $3)`,
    [threadId, tenantId, timestamp],
  );
}

async function seedMessage(
  db: TestDb,
  tenantId: string,
  messageId: string,
  threadId: string,
  identityId: string,
) {
  await db.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, occurred_at, created_at
     ) values ($1, $2, $3, $4, 'inbound', 'text', 'received', 'Bonjour',
       'canal-test', $5, 'ingress:canal-test:external_message_1',
       'correlation_conversation_1', $6, $6)`,
    [messageId, tenantId, threadId, identityId, `external_${messageId}`, timestamp],
  );
}
