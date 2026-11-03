import { describe, expect, it } from "vitest";
import type { DbClient } from "../src/lib/db";
import { loadImportReferenceData } from "../src/modules/imports/repository";

describe("références d’import sur une connexion unique", () => {
  it("charge les références du tenant sans chevauchement et normalise les clés", async () => {
    let active = false;
    const tenantIds: unknown[] = [];
    const db: DbClient = {
      async query<T>(sql: string, params?: unknown[]) {
        if (active) throw new Error("single_connection_query_overlap");
        active = true;
        try {
          tenantIds.push(params?.[0]);
          await Promise.resolve();
          const rows = sql.includes("from contacts") ? [{ email: "Client@Example.test" }]
            : sql.includes("from companies") ? [{ name: "Démo", domain: "EXAMPLE.TEST" }, { name: "Sans domaine", domain: null }]
              : sql.includes("from products") ? [{ sku: "SERVICE-01" }]
                : [{ name: "Nouveau Contact" }];
          return { rows: rows as T[] };
        } finally {
          active = false;
        }
      },
    };
    const references = await loadImportReferenceData(db, "tenant_demo");
    expect(references).toEqual({
      contactEmails: new Set(["client@example.test"]),
      companyNames: new Set(["démo", "sans domaine"]),
      companyDomains: new Set(["example.test"]),
      productSkus: new Set(["service-01"]),
      stageNames: new Set(["nouveau contact"]),
    });
    expect(tenantIds).toEqual(Array(4).fill("tenant_demo"));
  });

  it("arrête le chargement si une référence échoue", async () => {
    const statements: string[] = [];
    const db: DbClient = {
      async query<T>(sql: string) {
        statements.push(sql);
        if (sql.includes("from companies")) throw new Error("reference_unavailable");
        return { rows: [] as T[] };
      },
    };
    await expect(loadImportReferenceData(db, "tenant_demo")).rejects.toThrow("reference_unavailable");
    expect(statements.some(sql => sql.includes("from products") || sql.includes("from pipeline_stages"))).toBe(false);
  });
});
