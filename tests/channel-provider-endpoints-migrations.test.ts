import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryDb,
  getMigrationIds,
  migrate,
} from "../src/lib/db";

const opened: Array<{ close: () => Promise<void> }> = [];
const timestamp = "2026-07-30T17:20:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migrations des endpoints fournisseur OS-2", () => {
  it("garde les migrations runtime et leurs miroirs SQL identiques", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    const definitions = [
      [
        "os2ChannelProviderEndpointsMigrationSql",
        "../src/db/migrations/0079_os2_channel_provider_endpoints.sql",
      ],
      [
        "os2ChannelProviderEndpointsRlsMigrationSql",
        "../src/db/migrations/0080_os2_channel_provider_endpoints_rls.sql",
      ],
      [
        "os2WhatsAppMetaEndpointProviderMigrationSql",
        "../src/db/migrations/0093_os2_whatsapp_meta_endpoint_provider.sql",
      ],
    ] as const;

    for (const [constant, mirrorPath] of definitions) {
      const mirror = readFileSync(new URL(mirrorPath, import.meta.url), "utf8");
      expect(extractSqlTemplate(runtime, constant).trim()).toBe(mirror.trim());
    }
  });

  it("crée la table tenant-scoped sans colonne d'adresse ou de payload", async () => {
    expect(getMigrationIds()).toContain("085_os2_channel_provider_endpoints");
    expect(getMigrationIds()).toContain(
      "099_os2_whatsapp_meta_endpoint_provider",
    );
    expect(getMigrationIds(true)).toEqual(
      expect.arrayContaining([
        "085_os2_channel_provider_endpoints",
        "086_os2_channel_provider_endpoints_rls",
      ]),
    );

    const db = await createMemoryDb();
    opened.push(db);
    const unsafeColumns = await db.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'channel_provider_endpoints'
         and column_name in (
           'address', 'destination', 'phone_number', 'raw_body', 'payload',
           'credential', 'auth_token'
         )`,
    );
    expect(unsafeColumns.rows).toEqual([]);
  });

  it("interdit la réattribution inter-tenant et rend l'identité immuable", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await seedTenant(db, "user_a", "tenant_a");
    await seedTenant(db, "user_b", "tenant_b");
    await seedEndpoint(db, "endpoint_a", "tenant_a", "user_a", "a".repeat(64));

    await expect(
      seedEndpoint(db, "endpoint_b", "tenant_b", "user_b", "a".repeat(64)),
    ).rejects.toThrow(/unique|duplicate/i);
    await expect(
      db.query(
        `update channel_provider_endpoints
         set tenant_id = 'tenant_b', updated_at = $1
         where tenant_id = 'tenant_a' and id = 'endpoint_a'`,
        [timestamp],
      ),
    ).rejects.toThrow(/immutable/i);

    await db.query(
      `update channel_provider_endpoints
       set status = 'disabled', updated_at = $1
       where tenant_id = 'tenant_a' and id = 'endpoint_a'`,
      [timestamp],
    );
    const endpoint = await db.query<{ status: string }>(
      `select status from channel_provider_endpoints
       where tenant_id = 'tenant_a' and id = 'endpoint_a'`,
    );
    expect(endpoint.rows).toEqual([{ status: "disabled" }]);
  });

  it("refuse empreinte, provider et compte fournisseur non bornés", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await seedTenant(db, "user_a", "tenant_a");

    await expect(
      seedEndpoint(db, "bad_hash", "tenant_a", "user_a", "pas-un-hash"),
    ).rejects.toThrow(/check constraint|violates/i);
    await expect(
      seedEndpoint(
        db,
        "bad_account",
        "tenant_a",
        "user_a",
        "b".repeat(64),
        "compte avec espaces",
      ),
    ).rejects.toThrow(/check constraint|violates/i);
    await expect(
      db.query(
        `insert into channel_provider_endpoints (
           id, tenant_id, provider, external_account_id,
           destination_fingerprint, status, created_by, created_at, updated_at
         ) values ($1, $2, 'provider_inconnu', $3, $4, 'active', $5, $6, $6)`,
        [
          "bad_provider",
          "tenant_a",
          `AC${"c".repeat(32)}`,
          "c".repeat(64),
          "user_a",
          timestamp,
        ],
      ),
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("autorise l'endpoint WhatsApp Cloud Meta sans enregistrer de destination", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await seedTenant(db, "user_meta", "tenant_meta");

    await db.query(
      `insert into channel_provider_endpoints (
         id, tenant_id, provider, external_account_id,
         destination_fingerprint, status, created_by, created_at, updated_at
       ) values ($1, $2, 'whatsapp_meta', $3, $4, 'active', $5, $6, $6)`,
      [
        "endpoint_meta",
        "tenant_meta",
        "123456789",
        "e".repeat(64),
        "user_meta",
        timestamp,
      ],
    );

    const rows = await db.query<{ provider: string }>(
      "select provider from channel_provider_endpoints where id = 'endpoint_meta'",
    );
    expect(rows.rows).toEqual([{ provider: "whatsapp_meta" }]);
  });

  it("met à niveau une base existante avant d'autoriser WhatsApp Cloud Meta", async () => {
    const db = new PGlite();
    opened.push(db);
    await migrate(db, {
      targetMigrationId: "097_os5_channel_provider_activation_consumptions",
    });
    await seedTenant(db, "user_upgrade", "tenant_upgrade");

    await expect(
      seedMetaEndpoint(db, "endpoint_meta_before", "tenant_upgrade", "user_upgrade"),
    ).rejects.toThrow(/check constraint|violates/i);

    await migrate(db);
    await seedMetaEndpoint(
      db,
      "endpoint_meta_after",
      "tenant_upgrade",
      "user_upgrade",
    );
    const rows = await db.query<{ provider: string }>(
      "select provider from channel_provider_endpoints where id = 'endpoint_meta_after'",
    );
    expect(rows.rows).toEqual([{ provider: "whatsapp_meta" }]);
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function seedTenant(db: TestDb, userId: string, tenantId: string) {
  await db.query(
    `insert into users (id, name, email, password_hash, created_at)
     values ($1, $2, $3, 'hash', $4)`,
    [userId, `Utilisateur ${userId}`, `${userId}@example.test`, timestamp],
  );
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ($1, $2, $1, 'Services', $3)`,
    [tenantId, `Organisation ${tenantId}`, timestamp],
  );
}

async function seedEndpoint(
  db: TestDb,
  endpointId: string,
  tenantId: string,
  userId: string,
  fingerprint: string,
  externalAccountId = `AC${"d".repeat(32)}`,
) {
  await db.query(
    `insert into channel_provider_endpoints (
       id, tenant_id, provider, external_account_id,
       destination_fingerprint, status, created_by, created_at, updated_at
     ) values ($1, $2, 'whatsapp_twilio', $3, $4, 'active', $5, $6, $6)`,
    [endpointId, tenantId, externalAccountId, fingerprint, userId, timestamp],
  );
}

async function seedMetaEndpoint(
  db: TestDb,
  endpointId: string,
  tenantId: string,
  userId: string,
) {
  await db.query(
    `insert into channel_provider_endpoints (
       id, tenant_id, provider, external_account_id,
       destination_fingerprint, status, created_by, created_at, updated_at
     ) values ($1, $2, 'whatsapp_meta', $3, $4, 'active', $5, $6, $6)`,
    [
      endpointId,
      tenantId,
      "123456789",
      "f".repeat(64),
      userId,
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
