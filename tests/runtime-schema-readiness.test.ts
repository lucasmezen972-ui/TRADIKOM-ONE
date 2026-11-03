import { expect, it } from "vitest";
import { getMigrationIds, verifyRuntimeMigrations, type DbClient } from "../src/lib/db";

it("vérifie le schéma sans exiger de droits de création", async () => {
  const queries: string[] = [];
  const db = {
    async query(sql: string) {
      queries.push(sql);
      if (!sql.startsWith("select ")) throw new Error("DDL forbidden");
      return { rows: getMigrationIds(true).map((id) => ({ id })) };
    },
  } as DbClient;
  await verifyRuntimeMigrations(db);
  expect(queries).toHaveLength(1);
});

it("refuse un schéma incomplet sans tenter de le modifier", async () => {
  const db = { async query() { return { rows: [] }; } } as DbClient;
  await expect(verifyRuntimeMigrations(db)).rejects.toThrow("migration identity");
});

it("ne recopie pas une erreur de connexion sensible", async () => {
  const db = {
    async query() { throw new Error("postgres://private-credential@fixture"); },
  } as DbClient;
  await expect(verifyRuntimeMigrations(db)).rejects.toThrow("Database schema is not ready");
  await expect(verifyRuntimeMigrations(db)).rejects.not.toThrow("private-credential");
});
