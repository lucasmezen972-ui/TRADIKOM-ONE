import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, getMigrationIds, migrate } from "../src/lib/db";

const opened: Array<{ close: () => Promise<void> }> = [];
const timestamp = "2026-08-08T12:00:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migrations du coffre fournisseur OS-5", () => {
  it("garde les migrations runtime et leurs miroirs SQL identiques", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    for (const [constant, path] of [
      [
        "os5ChannelProviderSecretVersionsMigrationSql",
        "../src/db/migrations/0087_os5_channel_provider_secret_versions.sql",
      ],
      [
        "os5ChannelProviderSecretVersionsRlsMigrationSql",
        "../src/db/migrations/0088_os5_channel_provider_secret_versions_rls.sql",
      ],
      [
        "os5ChannelProviderSecretVersionsMetaMigrationSql",
        "../src/db/migrations/0097_os5_channel_provider_secret_versions_meta.sql",
      ],
    ] as const) {
      const mirror = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(extractSqlTemplate(runtime, constant).trim()).toBe(mirror.trim());
    }
    expect(getMigrationIds()).toContain(
      "093_os5_channel_provider_secret_versions",
    );
    expect(getMigrationIds(true)).toContain(
      "094_os5_channel_provider_secret_versions_rls",
    );
    expect(getMigrationIds()).toContain(
      "103_os5_channel_provider_secret_versions_meta",
    );
  });

  it("ne contient aucune colonne en clair et impose versions et références composées", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public'
         and table_name = 'channel_provider_secret_versions'
       order by ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "id",
      "tenant_id",
      "provider",
      "endpoint_id",
      "channel_identity_id",
      "secret_scope",
      "encrypted_payload",
      "key_version",
      "secret_version",
      "rotation_key_hash",
      "revoked_at",
      "revoked_by",
      "created_by",
      "created_at",
    ]);
    expect(JSON.stringify(columns.rows)).not.toMatch(
      /account_sid|auth_token|sender|recipient|phone|address|body|credential/i,
    );

    await seedVaultContext(db, "a");
    await seedVaultContext(db, "b");
    await expect(
      insertSecret(db, {
        id: "secret_cross",
        tenantId: "tenant_a",
        endpointId: "endpoint_b",
        identityId: null,
        scope: "endpoint",
        version: 1,
        rotationHash: "c".repeat(64),
      }),
    ).rejects.toThrow(/foreign key|violates/i);

    await insertSecret(db, {
      id: "secret_a",
      tenantId: "tenant_a",
      endpointId: "endpoint_a",
      identityId: null,
      scope: "endpoint",
      version: 1,
      rotationHash: "a".repeat(64),
    });
    await seedMetaVaultContext(db);
    await insertSecret(db, {
      id: "secret_meta",
      tenantId: "tenant_a",
      provider: "whatsapp_meta",
      endpointId: "endpoint_meta_a",
      identityId: null,
      scope: "endpoint",
      version: 1,
      rotationHash: "d".repeat(64),
    });
    await expect(
      insertSecret(db, {
        id: "secret_provider_mismatch",
        tenantId: "tenant_a",
        provider: "whatsapp_meta",
        endpointId: "endpoint_a",
        identityId: null,
        scope: "endpoint",
        version: 1,
        rotationHash: "e".repeat(64),
      }),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      insertSecret(db, {
        id: "secret_a_second_active",
        tenantId: "tenant_a",
        endpointId: "endpoint_a",
        identityId: null,
        scope: "endpoint",
        version: 2,
        rotationHash: "b".repeat(64),
      }),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("rend le ciphertext immuable, la révocation monotone et permet la suppression tenant", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await seedVaultContext(db, "a");
    await insertSecret(db, {
      id: "secret_a",
      tenantId: "tenant_a",
      endpointId: "endpoint_a",
      identityId: "identity_a",
      scope: "identity",
      version: 1,
      rotationHash: "a".repeat(64),
    });
    await expect(
      db.query(
        `update channel_provider_secret_versions
         set encrypted_payload = $1 where id = 'secret_a'`,
        [`{"ciphertext":"${"z".repeat(80)}"}`],
      ),
    ).rejects.toThrow(/immutable/i);
    await db.query(
      `update channel_provider_secret_versions
       set revoked_at = $1, revoked_by = 'user_a' where id = 'secret_a'`,
      [timestamp],
    );
    await expect(
      db.query(
        `update channel_provider_secret_versions
         set revoked_at = null, revoked_by = null where id = 'secret_a'`,
      ),
    ).rejects.toThrow(/immutable/i);
    await db.query("delete from tenants where id = 'tenant_a'");
    expect(
      (
        await db.query(
          "select id from channel_provider_secret_versions where id = 'secret_a'",
        )
      ).rows,
    ).toEqual([]);
  });

  it("met à niveau une base existante avant d'autoriser les secrets Meta", async () => {
    const db = new PGlite();
    opened.push(db);
    await migrate(db, {
      targetMigrationId: "101_os5_channel_provider_identity_bindings",
    });
    await seedVaultContext(db, "a");
    await seedMetaVaultContext(db);

    await expect(
      insertSecret(db, {
        id: "secret_meta_before",
        tenantId: "tenant_a",
        provider: "whatsapp_meta",
        endpointId: "endpoint_meta_a",
        identityId: null,
        scope: "endpoint",
        version: 1,
        rotationHash: "a".repeat(64),
      }),
    ).rejects.toThrow(/check constraint|violates/i);

    await migrate(db);
    await insertSecret(db, {
      id: "secret_meta_after",
      tenantId: "tenant_a",
      provider: "whatsapp_meta",
      endpointId: "endpoint_meta_a",
      identityId: null,
      scope: "endpoint",
      version: 1,
      rotationHash: "b".repeat(64),
    });
    await expect(
      insertSecret(db, {
        id: "secret_wrong_provider_after",
        tenantId: "tenant_a",
        provider: "whatsapp_twilio",
        endpointId: "endpoint_meta_a",
        identityId: null,
        scope: "endpoint",
        version: 1,
        rotationHash: "c".repeat(64),
      }),
    ).rejects.toThrow(/foreign key|violates/i);
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function seedVaultContext(db: TestDb, suffix: "a" | "b") {
  await db.query(
    `insert into users (id, name, email, password_hash, created_at)
     values ($1, $2, $3, 'hash', $4)`,
    [`user_${suffix}`, `Utilisateur ${suffix}`, `vault-${suffix}@example.test`, timestamp],
  );
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ($1, $2, $1, 'Services', $3)`,
    [`tenant_${suffix}`, `Organisation ${suffix}`, timestamp],
  );
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ($1, $2, 'customer', null, $3, $3)`,
    [`participant_${suffix}`, `tenant_${suffix}`, timestamp],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values ($1, $2, $3, 'messaging', 'whatsapp-twilio', $4, null,
       'customer', 'active', $5, $5)`,
    [
      `identity_${suffix}`,
      `tenant_${suffix}`,
      `participant_${suffix}`,
      `subject_${suffix}`,
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
      `tenant_${suffix}`,
      `AC${suffix.repeat(32)}`,
      suffix.repeat(64),
      `user_${suffix}`,
      timestamp,
    ],
  );
}

async function seedMetaVaultContext(db: TestDb) {
  await db.query(
    `insert into channel_provider_endpoints (
       id, tenant_id, provider, external_account_id,
       destination_fingerprint, status, created_by, created_at, updated_at
     ) values (
       'endpoint_meta_a', 'tenant_a', 'whatsapp_meta', '123456789012345',
       $1, 'active', 'user_a', $2, $2
     )`,
    ["f".repeat(64), timestamp],
  );
}

async function insertSecret(
  db: TestDb,
  input: {
    id: string;
    tenantId: string;
    endpointId: string;
    provider?: "whatsapp_twilio" | "whatsapp_meta";
    identityId: string | null;
    scope: "endpoint" | "identity";
    version: number;
    rotationHash: string;
  },
) {
  return db.query(
    `insert into channel_provider_secret_versions (
       id, tenant_id, provider, endpoint_id, channel_identity_id,
       secret_scope, encrypted_payload, key_version, secret_version,
       rotation_key_hash, revoked_at, revoked_by, created_by, created_at
    ) values ($1, $2, $3, $4, $5, $6, $7, 'test-v1',
       $8, $9, null, null, $10, $11)`,
    [
      input.id,
      input.tenantId,
      input.provider ?? "whatsapp_twilio",
      input.endpointId,
      input.identityId,
      input.scope,
      `{"ciphertext":"${"x".repeat(80)}"}`,
      input.version,
      input.rotationHash,
      `user_${input.tenantId.slice(-1)}`,
      timestamp,
    ],
  );
}

function extractSqlTemplate(source: string, constantName: string) {
  const start = source.indexOf(`const ${constantName} = \``);
  if (start < 0) throw new Error(`Constante absente: ${constantName}`);
  const bodyStart = source.indexOf("`", start) + 1;
  const bodyEnd = source.indexOf("`;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}
