import { afterEach, expect, it, vi } from "vitest";
import { getMigrationIds, verifyRuntimeMigrations, type DbClient } from "../src/lib/db";

afterEach(() => vi.restoreAllMocks());

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
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const db = {
    async query() { throw new Error("postgres://private-credential@fixture"); },
  } as DbClient;
  await expect(verifyRuntimeMigrations(db)).rejects.toThrow("Database schema is not ready");
  await expect(verifyRuntimeMigrations(db)).rejects.not.toThrow("private-credential");
  expect(log.mock.calls.flat().join(" ")).not.toContain("private-credential");
});

it("journalise uniquement un code de connexion connu, sans message sensible", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const db = { async query() {
    throw Object.assign(new Error("postgres://private-credential@fixture"), {
      code: "SELF_SIGNED_CERT_IN_CHAIN",
    });
  } } as DbClient;
  await expect(verifyRuntimeMigrations(db)).rejects.toThrow("Database schema is not ready");
  expect(log).toHaveBeenCalledWith(JSON.stringify({
    event: "database.readiness.failed", code: "SELF_SIGNED_CERT_IN_CHAIN",
  }));
});

it("ne journalise pas un code arbitraire fourni par une dépendance", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const db = { async query() {
    throw { code: "private-credential", message: "private-credential" };
  } } as DbClient;
  await expect(verifyRuntimeMigrations(db)).rejects.toThrow();
  expect(log).toHaveBeenCalledWith(JSON.stringify({
    event: "database.readiness.failed", code: "unknown",
  }));
});
