import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, getMigrationIds, migrate } from "../src/lib/db";

const opened: Array<{ close: () => Promise<void> }> = [];
const authorizedAt = "2026-08-08T16:00:00.000Z";
const expiresAt = "2026-08-08T17:00:00.000Z";
const revokedAt = "2026-08-08T16:30:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migrations des autorisations d'activation OS-5", () => {
  it("garde les migrations runtime et leurs miroirs SQL identiques", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    for (const [constant, path] of [
      [
        "os5ChannelProviderActivationAuthorizationsMigrationSql",
        "../src/db/migrations/0089_os5_channel_provider_activation_authorizations.sql",
      ],
      [
        "os5ChannelProviderActivationAuthorizationsRlsMigrationSql",
        "../src/db/migrations/0090_os5_channel_provider_activation_authorizations_rls.sql",
      ],
    ] as const) {
      const mirror = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(extractSqlTemplate(runtime, constant).trim()).toBe(mirror.trim());
    }
    expect(getMigrationIds()).toContain(
      "095_os5_channel_provider_activation_authorizations",
    );
    expect(getMigrationIds(true)).toContain(
      "096_os5_channel_provider_activation_authorizations_rls",
    );
  });

  it("crée une preuve tenant-scoped sans colonne sensible et supporte une base déjà migrée", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public'
         and table_name = 'channel_provider_activation_authorizations'
       order by ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "id",
      "tenant_id",
      "provider",
      "endpoint_id",
      "authorization_scope",
      "max_messages",
      "free_units_confirmed",
      "idempotency_key_hash",
      "authorized_by",
      "authorized_at",
      "expires_at",
      "revoked_at",
      "revoked_by",
    ]);
    expect(JSON.stringify(columns.rows)).not.toMatch(
      /secret|token|account_sid|phone|number|address|url|body|content|ciphertext/i,
    );

    await seedAuthorizationContext(db, "a");
    await insertAuthorization(db, {
      id: "authorization_a",
      tenantId: "tenant_a",
      endpointId: "endpoint_a",
      maxMessages: 2,
      idempotencyHash: "a".repeat(64),
    });
    await migrate(db);
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from channel_provider_activation_authorizations",
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  it("impose relations composées, portée Sandbox et plafond de deux messages", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await seedAuthorizationContext(db, "a");
    await seedAuthorizationContext(db, "b");

    await expect(
      insertAuthorization(db, {
        id: "authorization_cross",
        tenantId: "tenant_a",
        endpointId: "endpoint_b",
        maxMessages: 1,
        idempotencyHash: "a".repeat(64),
      }),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      insertAuthorization(db, {
        id: "authorization_over_limit",
        tenantId: "tenant_a",
        endpointId: "endpoint_a",
        maxMessages: 3,
        idempotencyHash: "b".repeat(64),
      }),
    ).rejects.toThrow(/check|violates/i);
    await expect(
      db.query(
        `insert into channel_provider_activation_authorizations (
           id, tenant_id, provider, endpoint_id, authorization_scope,
           max_messages, free_units_confirmed, idempotency_key_hash,
           authorized_by, authorized_at, expires_at, revoked_at, revoked_by
         ) values (
           'authorization_wrong_scope', 'tenant_a', 'whatsapp_twilio',
           'endpoint_a', 'production', 1, true, $1, 'user_a', $2, $3,
           null, null
         )`,
        ["c".repeat(64), authorizedAt, expiresAt],
      ),
    ).rejects.toThrow(/check|violates/i);
  });

  it("rend la preuve immuable, la révocation monotone et la suppression tenant transactionnelle", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await seedAuthorizationContext(db, "a");
    await insertAuthorization(db, {
      id: "authorization_a",
      tenantId: "tenant_a",
      endpointId: "endpoint_a",
      maxMessages: 2,
      idempotencyHash: "a".repeat(64),
    });

    await expect(
      db.query(
        `update channel_provider_activation_authorizations
         set max_messages = 1 where id = 'authorization_a'`,
      ),
    ).rejects.toThrow(/immutable/i);
    await db.query(
      `update channel_provider_activation_authorizations
       set revoked_at = $1, revoked_by = 'user_a'
       where id = 'authorization_a'`,
      [revokedAt],
    );
    await expect(
      db.query(
        `update channel_provider_activation_authorizations
         set revoked_at = null, revoked_by = null
         where id = 'authorization_a'`,
      ),
    ).rejects.toThrow(/immutable/i);

    await db.query("delete from tenants where id = 'tenant_a'");
    expect(
      (
        await db.query(
          "select id from channel_provider_activation_authorizations where id = 'authorization_a'",
        )
      ).rows,
    ).toEqual([]);
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function seedAuthorizationContext(db: TestDb, suffix: "a" | "b") {
  await db.query(
    `insert into users (id, name, email, password_hash, created_at)
     values ($1, $2, $3, 'hash', $4)`,
    [
      `user_${suffix}`,
      `Utilisateur ${suffix}`,
      `activation-${suffix}@example.test`,
      authorizedAt,
    ],
  );
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ($1, $2, $1, 'Services', $3)`,
    [`tenant_${suffix}`, `Organisation ${suffix}`, authorizedAt],
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
      authorizedAt,
    ],
  );
}

async function insertAuthorization(
  db: TestDb,
  input: {
    id: string;
    tenantId: string;
    endpointId: string;
    maxMessages: number;
    idempotencyHash: string;
  },
) {
  return db.query(
    `insert into channel_provider_activation_authorizations (
       id, tenant_id, provider, endpoint_id, authorization_scope,
       max_messages, free_units_confirmed, idempotency_key_hash,
       authorized_by, authorized_at, expires_at, revoked_at, revoked_by
     ) values (
       $1, $2, 'whatsapp_twilio', $3, 'twilio_whatsapp_sandbox',
       $4, true, $5, $6, $7, $8, null, null
     )`,
    [
      input.id,
      input.tenantId,
      input.endpointId,
      input.maxMessages,
      input.idempotencyHash,
      `user_${input.tenantId.slice(-1)}`,
      authorizedAt,
      expiresAt,
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
