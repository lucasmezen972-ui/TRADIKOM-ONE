import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, getMigrationIds } from "../src/lib/db";
import { reserveMetaWhatsAppIdentityBinding } from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const timestamp = "2026-08-19T16:50:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migrations des liaisons endpoint-identité Meta", () => {
  it("garde les migrations runtime, SQL et RLS identiques", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    const definitions = [
      [
        "os5ChannelProviderIdentityBindingsMigrationSql",
        "../src/db/migrations/0083_os5_channel_provider_identity_bindings.sql",
      ],
      [
        "os5ChannelProviderIdentityBindingsRlsMigrationSql",
        "../src/db/migrations/0084_os5_channel_provider_identity_bindings_rls.sql",
      ],
    ] as const;
    for (const [constant, mirrorPath] of definitions) {
      const mirror = readFileSync(new URL(mirrorPath, import.meta.url), "utf8");
      expect(extractSqlTemplate(runtime, constant).trim()).toBe(mirror.trim());
    }
    expect(getMigrationIds()).toContain(
      "089_os5_channel_provider_identity_bindings",
    );
    expect(getMigrationIds(true)).toContain(
      "090_os5_channel_provider_identity_bindings_rls",
    );
  });

  it(
    "ne conserve aucune destination et rend la route endpoint-identité immuable",
    async () => {
      const db = await createMemoryDb();
      opened.push(db);
      await seedContext(db);

      const first = await reserveMetaWhatsAppIdentityBinding(db, {
        id: "binding_meta_a",
        tenantId: "tenant_a",
        endpointId: "endpoint_meta_a",
        channelIdentityId: "identity_meta_a",
        createdAt: timestamp,
      });
      const replay = await reserveMetaWhatsAppIdentityBinding(db, {
        id: "binding_meta_replay",
        tenantId: "tenant_a",
        endpointId: "endpoint_meta_a",
        channelIdentityId: "identity_meta_a",
        createdAt: timestamp,
      });

      expect(first.replayed).toBe(false);
      expect(replay).toMatchObject({
        replayed: true,
        row: { id: "binding_meta_a" },
      });
      await expect(
        reserveMetaWhatsAppIdentityBinding(db, {
          id: "binding_meta_conflict",
          tenantId: "tenant_a",
          endpointId: "endpoint_meta_b",
          channelIdentityId: "identity_meta_a",
          createdAt: timestamp,
        }),
      ).rejects.toMatchObject({
        code: "channel_provider_identity_binding_conflict",
      });
      await expect(
        db.query(
          `update channel_provider_identity_bindings
           set endpoint_id = 'endpoint_meta_b'
           where tenant_id = 'tenant_a' and id = 'binding_meta_a'`,
        ),
      ).rejects.toThrow(/immutable/i);

      const unsafeColumns = await db.query<{ column_name: string }>(
        `select column_name
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'channel_provider_identity_bindings'
           and column_name in (
             'address', 'destination', 'phone_number', 'text', 'body',
             'raw_body', 'payload', 'credential', 'auth_token'
           )`,
      );
      expect(unsafeColumns.rows).toEqual([]);
    },
    20_000,
  );
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function seedContext(db: TestDb) {
  await db.query(
    `insert into users (id, name, email, password_hash, created_at)
     values ('user_a', 'Utilisateur Meta', 'meta-bindings@example.test', 'hash', $1)`,
    [timestamp],
  );
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ('tenant_a', 'Organisation Meta', 'tenant-a-meta', 'Services', $1)`,
    [timestamp],
  );
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ('participant_meta_a', 'tenant_a', 'customer', null, $1, $1)`,
    [timestamp],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values (
       'identity_meta_a', 'tenant_a', 'participant_meta_a', 'messaging',
       'whatsapp-meta', 'meta_subject_opaque', null, 'customer', 'active', $1, $1
     )`,
    [timestamp],
  );
  for (const endpointId of ["endpoint_meta_a", "endpoint_meta_b"]) {
    await db.query(
      `insert into channel_provider_endpoints (
         id, tenant_id, provider, external_account_id,
         destination_fingerprint, status, created_by, created_at, updated_at
       ) values ($1, 'tenant_a', 'whatsapp_meta', $2, $3, 'active', 'user_a', $4, $4)`,
      [
        endpointId,
        endpointId === "endpoint_meta_a" ? "123456789" : "222333444",
        endpointId === "endpoint_meta_a" ? "a".repeat(64) : "b".repeat(64),
        timestamp,
      ],
    );
  }
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
