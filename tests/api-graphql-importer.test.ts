import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { setPlatformRole } from "../src/modules/platform-admin";

const databases: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("GraphQL supplied schema import", () => {
  it("persists structural claims and monitors a removed mutation without live introspection", async () => {
    const db = await createMemoryDb();
    databases.push(db);
    const schema = await fixture("mock-garage-graphql.graphql");
    const changedSchema = schema.replace(
      "  createContact(input: CreateContactInput!): Contact!\n",
      "",
    );
    let serveChangedSchema = false;
    const services = createServices(db, {
      discoveryTransport: async (url) => {
        if (url.pathname === "/robots.txt") {
          return {
            status: 200,
            headers: { "content-type": "text/plain" },
            body: "User-agent: TradikomApiScout\nAllow: /",
          };
        }
        return {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
          body: serveChangedSchema ? changedSchema : schema,
        };
      },
    });
    const admin = await services.registerUser({
      name: "Admin GraphQL",
      email: "graphql-admin@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(admin.id, {
      name: "Garage GraphQL",
      category: "Garage automobile",
    });
    await setPlatformRole(db, admin.id, "platform_admin");

    const software = await services.createSoftwareDirectoryEntry(
      admin.id,
      tenant.id,
      {
        canonicalName: "Garage Cloud GraphQL",
        aliases: [],
        vendor: "Garage Cloud SAS",
        officialDomain: "docs.graphql-garage.test",
        supportedRegions: ["Europe"],
        languages: ["fr"],
        industries: ["Automobile"],
        categories: ["Gestion de garage"],
        officialWebsite: "https://docs.graphql-garage.test/",
      },
    );
    await services.decideSoftwareDomain(admin.id, tenant.id, {
      domainId: software.domainId,
      status: "approved",
      reason: "Domaine officiel verifie.",
    });
    const api = await services.createApiProductRecord(admin.id, tenant.id, {
      softwareId: software.softwareId,
      name: "Garage Cloud GraphQL API",
      apiStyle: "graphql",
      version: "2026-07",
      documentationUrl: "https://docs.graphql-garage.test/reference",
    });
    const source = await services.addOfficialApiSource(admin.id, tenant.id, {
      softwareId: software.softwareId,
      apiProductId: api.apiProductId,
      url: "https://docs.graphql-garage.test/schema.graphql",
      sourceType: "official_graphql_schema",
    });
    const snapshot = await services.fetchApprovedApiSource(
      admin.id,
      tenant.id,
      source.sourceId,
    );
    const preview = await services.previewApiSnapshot(admin.id, tenant.id, {
      snapshotId: snapshot.id,
      apiProductId: api.apiProductId,
    });
    expect(preview.parserVersion).toBe("graphql-1");
    if (preview.parserVersion !== "graphql-1") {
      throw new Error("Apercu GraphQL attendu.");
    }
    expect(preview).toMatchObject({
      sourceFormat: "sdl",
      title: "Garage Cloud GraphQL API",
      version: "2026-07",
      redactedDefaultValueCount: 2,
    });
    expect(preview.operations).toHaveLength(4);

    const imported = await services.persistApiPreview(admin.id, tenant.id, preview);
    expect(imported.operationCount).toBe(4);
    expect(imported.schemaCount).toBeGreaterThan(3);
    expect(imported.claimIds).toHaveLength(
      1 + imported.operationCount + imported.schemaCount,
    );

    const product = await db.query<{ graphql_schema_url: string | null }>(
      "select graphql_schema_url from api_products where id = $1",
      [api.apiProductId],
    );
    expect(product.rows[0]?.graphql_schema_url).toBe(
      "https://docs.graphql-garage.test/schema.graphql",
    );
    const persisted = await db.query<{
      claim_value: string;
      approval_status: string;
      locator: string;
    }>(
      `select api_claims.claim_value, api_claims.approval_status,
              api_evidence.locator
       from api_claims
       join api_evidence on api_evidence.claim_id = api_claims.id
       where api_claims.source_snapshot_id = $1
       order by api_evidence.locator asc`,
      [snapshot.id],
    );
    expect(persisted.rows.every((claim) =>
      claim.approval_status === "under_review"
    )).toBe(true);
    expect(persisted.rows.some((claim) =>
      claim.locator === "#/types/Mutation/fields/createContact"
    )).toBe(true);
    const serializedClaims = JSON.stringify(persisted.rows);
    expect(serializedClaims).not.toContain("internal-secret");
    expect(serializedClaims).not.toContain("Documentation sensible");
    expect(serializedClaims).not.toContain("deleteContact");

    for (const claimId of imported.claimIds) {
      await services.decideApiClaim(admin.id, tenant.id, {
        claimId,
        status: "approved",
        reason: "Schema GraphQL officiel verifie.",
      });
    }
    const compatibility = await services.runCompatibilityCheck(
      admin.id,
      tenant.id,
      {
        softwareId: software.softwareId,
        apiProductId: api.apiProductId,
        tenantIndustry: "Garage automobile",
        desiredAutomation: "Lire et creer des contacts.",
      },
    );
    expect(compatibility.readableOperations).toHaveLength(2);
    expect(compatibility.writableOperations).toHaveLength(2);

    serveChangedSchema = true;
    await services.fetchApprovedApiSource(admin.id, tenant.id, source.sourceId);
    const changes = await db.query<{
      primary_classification: string;
      summary: string;
    }>(
      `select primary_classification, summary from api_change_events
       where source_id = $1`,
      [source.sourceId],
    );
    expect(changes.rows).toHaveLength(1);
    expect(changes.rows[0]?.primary_classification).toBe("breaking");
    expect(JSON.parse(changes.rows[0]?.summary ?? "{}")).toMatchObject({
      changes: expect.arrayContaining([
        expect.objectContaining({
          kind: "endpoint_removed",
          target: "mutation.createContact",
        }),
      ]),
    });

    const audit = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action = 'api_intelligence.graphql_imported'`,
      [tenant.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.safe_metadata).not.toContain("internal-secret");
  });
});

async function fixture(name: string) {
  return readFile(path.join(process.cwd(), "tests", "fixtures", name), "utf8");
}
