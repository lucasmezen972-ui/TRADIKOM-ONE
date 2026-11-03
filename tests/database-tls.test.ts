import { expect, it } from "vitest";
import { getPgPoolConfig } from "../src/db/client";

const connectionString = "postgresql://app:fixture@db.example.com:6543/postgres?sslmode=verify-full";

it("conserve les options existantes sans certificat personnalisé", () => {
  expect(getPgPoolConfig({ DATABASE_URL: connectionString })).toEqual({ connectionString, max: 10 });
});

it("vérifie le certificat et le nom d'hôte sans laisser l'URL écraser le CA", () => {
  const config = getPgPoolConfig({ DATABASE_URL: connectionString, DATABASE_SSL_CA: "fixture-ca", DATABASE_POOL_MAX: "3" });
  expect(config.ssl).toEqual({ ca: "fixture-ca", rejectUnauthorized: true });
  expect(new URL(config.connectionString!).searchParams.has("sslmode")).toBe(false);
  expect(config.max).toBe(3);
});

it.each(["sslmode=disable", "sslmode=require", "sslrootcert=other", "sslkey=other", "sslcert=other", "uselibpqcompat=true"])("refuse une option TLS contradictoire : %s", (option) => {
  expect(() => getPgPoolConfig({ DATABASE_URL: `postgresql://app:fixture@db.example.com/postgres?${option}`, DATABASE_SSL_CA: "fixture-ca" })).toThrow("conflicting URL TLS options");
});
