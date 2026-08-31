import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, getMigrationIds, migrate } from "../src/lib/db";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migrations de consommation d'activation OS-5", () => {
  it("garde les migrations runtime et leurs miroirs SQL identiques", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    for (const [constant, path] of [
      [
        "os5ChannelProviderActivationConsumptionsMigrationSql",
        "../src/db/migrations/0091_os5_channel_provider_activation_consumptions.sql",
      ],
      [
        "os5ChannelProviderActivationConsumptionsRlsMigrationSql",
        "../src/db/migrations/0092_os5_channel_provider_activation_consumptions_rls.sql",
      ],
    ] as const) {
      const mirror = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(extractSqlTemplate(runtime, constant).trim()).toBe(mirror.trim());
    }
    expect(getMigrationIds()).toContain(
      "097_os5_channel_provider_activation_consumptions",
    );
    expect(getMigrationIds(true)).toContain(
      "098_os5_channel_provider_activation_consumptions_rls",
    );
  });

  it("s'applique sur base vide et sur le dernier schéma déjà migré", async () => {
    const fresh = await createMemoryDb();
    opened.push(fresh);
    expect(await tableColumns(fresh)).toEqual(expectedColumns);

    const upgraded = new PGlite();
    opened.push(upgraded);
    await migrate(upgraded, {
      targetMigrationId: "095_os5_channel_provider_activation_authorizations",
    });
    expect(await tableColumns(upgraded)).toEqual([]);
    await migrate(upgraded);
    expect(await tableColumns(upgraded)).toEqual(expectedColumns);
  });

  it("ne stocke aucune donnée provider sensible et rend la consommation immuable", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const columns = await tableColumns(db);
    expect(columns).toEqual(expectedColumns);
    expect(JSON.stringify(columns)).not.toMatch(
      /secret|token|account_sid|phone|number|address|url|body|content|ciphertext|message_text/i,
    );
    const triggers = await db.query<{ trigger_name: string }>(
      `select trigger_name from information_schema.triggers
       where event_object_table = 'channel_provider_activation_consumptions'
       order by trigger_name`,
    );
    expect(triggers.rows.map((row) => row.trigger_name)).toEqual([
      "channel_provider_activation_consumptions_budget",
      "channel_provider_activation_consumptions_immutable",
    ]);
  });
});

const expectedColumns = [
  "id",
  "tenant_id",
  "provider",
  "endpoint_id",
  "authorization_id",
  "delivery_id",
  "consumed_by",
  "consumed_at",
];

async function tableColumns(db: {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}) {
  const result = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_schema = 'public'
       and table_name = 'channel_provider_activation_consumptions'
     order by ordinal_position`,
  );
  return result.rows.map((row) => row.column_name);
}

function extractSqlTemplate(source: string, constantName: string) {
  const start = source.indexOf(`const ${constantName} = \``);
  if (start < 0) throw new Error(`Constante absente: ${constantName}`);
  const bodyStart = source.indexOf("`", start) + 1;
  const bodyEnd = source.indexOf("`;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}
