import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, getMigrationIds } from "../src/lib/db";

const opened: Array<{ close: () => Promise<void> }> = [];
const timestamp = "2026-08-08T06:00:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migrations des livraisons fournisseur OS-5", () => {
  it("garde les migrations runtime et leurs miroirs SQL identiques", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    const definitions = [
      [
        "os5ChannelProviderDeliveriesMigrationSql",
        "../src/db/migrations/0070_os5_channel_provider_deliveries.sql",
      ],
      [
        "os5ChannelProviderDeliveriesRlsMigrationSql",
        "../src/db/migrations/0071_os5_channel_provider_deliveries_rls.sql",
      ],
    ] as const;

    for (const [constant, mirrorPath] of definitions) {
      const mirror = readFileSync(new URL(mirrorPath, import.meta.url), "utf8");
      expect(extractSqlTemplate(runtime, constant).trim()).toBe(mirror.trim());
    }
    expect(getMigrationIds()).toContain("076_os5_channel_provider_deliveries");
    expect(getMigrationIds(true)).toContain(
      "077_os5_channel_provider_deliveries_rls",
    );
  });

  it("ne crée aucune colonne de téléphone, contenu, payload ou credential", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const unsafe = await db.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'channel_provider_deliveries'
         and column_name in (
           'address', 'destination', 'phone_number', 'text', 'body',
           'raw_body', 'payload', 'credential', 'auth_token'
         )`,
    );
    expect(unsafe.rows).toEqual([]);
  });

  it("impose les relations tenant composées et l'identité immuable", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await seedContext(db, "a");
    await seedContext(db, "b");
    await seedDelivery(db, "a");

    await expect(
      db.query(
        `update channel_provider_deliveries
         set tenant_id = 'tenant_b', updated_at = $1
         where tenant_id = 'tenant_a' and id = 'delivery_a'`,
        [timestamp],
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(
      db.query(
        `insert into channel_provider_deliveries (
           id, tenant_id, provider, endpoint_id, message_id,
           channel_identity_id, idempotency_key, request_fingerprint, status,
           external_message_id, failure_classification, safe_error_code,
           retryable, created_by, created_at, updated_at
         ) values (
           'delivery_cross', 'tenant_a', 'whatsapp_twilio', 'endpoint_b',
           'message_a', 'identity_a', 'delivery-cross-tenant', $1, 'reserved',
           null, null, null, null, 'user_a', $2, $2
         )`,
        ["c".repeat(64), timestamp],
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
       $1, $2, $3, 'messaging', 'whatsapp-twilio', $4, null,
       'customer', 'active', $5, $5
     )`,
    [identityId, tenantId, participantId, `subject_${suffix}`, timestamp],
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
       $1, $2, $3, $4, 'outbound', 'text', 'pending', 'Message test',
       'whatsapp-twilio', null, $5, $6, null, null, $7, $7
     )`,
    [
      `message_${suffix}`,
      tenantId,
      threadId,
      identityId,
      `message-idempotency-${suffix}`,
      `message-correlation-${suffix}`,
      timestamp,
    ],
  );
  await db.query(
    `insert into channel_provider_endpoints (
       id, tenant_id, provider, external_account_id,
       destination_fingerprint, status, created_by, created_at, updated_at
     ) values ($1, $2, 'whatsapp_twilio', $3, $4, 'active', $5, $6, $6)`,
    [
      `endpoint_${suffix}`,
      tenantId,
      `AC${suffix.repeat(32)}`,
      suffix.repeat(64),
      userId,
      timestamp,
    ],
  );
}

async function seedDelivery(db: TestDb, suffix: "a" | "b") {
  await db.query(
    `insert into channel_provider_deliveries (
       id, tenant_id, provider, endpoint_id, message_id, channel_identity_id,
       idempotency_key, request_fingerprint, status, external_message_id,
       failure_classification, safe_error_code, retryable, created_by,
       created_at, updated_at
     ) values (
       $1, $2, 'whatsapp_twilio', $3, $4, $5, $6, $7, 'reserved', null,
       null, null, null, $8, $9, $9
     )`,
    [
      `delivery_${suffix}`,
      `tenant_${suffix}`,
      `endpoint_${suffix}`,
      `message_${suffix}`,
      `identity_${suffix}`,
      `delivery-idempotency-${suffix}`,
      suffix.repeat(64),
      `user_${suffix}`,
      timestamp,
    ],
  );
}

function extractSqlTemplate(source: string, constant: string) {
  const prefix = "const " + constant + " = `";
  const start = source.indexOf(prefix);
  if (start < 0) throw new Error(`Migration runtime absente : ${constant}.`);
  const sqlStart = start + prefix.length;
  const sqlEnd = source.indexOf("`;", sqlStart);
  if (sqlEnd < 0) throw new Error(`Migration runtime invalide : ${constant}.`);
  return source.slice(sqlStart, sqlEnd);
}
