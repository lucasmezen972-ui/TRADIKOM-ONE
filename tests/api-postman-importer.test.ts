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

describe("Postman Collection v2.1 import", () => {
  it("persists reviewed metadata and blocks destructive cross-format replacement", async () => {
    const db = await createMemoryDb();
    databases.push(db);
    const postman = await fixture("mock-garage-postman-v2.1.json");
    const openApi = await fixture("mock-garage-openapi.json");
    const changedPostmanDocument = JSON.parse(postman) as {
      item: Array<{ item?: unknown[] }>;
    };
    changedPostmanDocument.item[0]?.item?.splice(1, 1);
    const changedPostman = JSON.stringify(changedPostmanDocument);
    let serveChangedPostman = false;
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
          headers: { "content-type": "application/json" },
          body: url.pathname.endsWith("openapi.json")
            ? openApi
            : serveChangedPostman
              ? changedPostman
              : postman,
        };
      },
    });
    const admin = await services.registerUser({
      name: "Admin Postman",
      email: "postman-admin@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(admin.id, {
      name: "Garage Postman",
      category: "Garage automobile",
    });
    await setPlatformRole(db, admin.id, "platform_admin");

    const software = await services.createSoftwareDirectoryEntry(
      admin.id,
      tenant.id,
      {
        canonicalName: "Garage Cloud Postman",
        aliases: ["GCP"],
        vendor: "Garage Cloud SAS",
        officialDomain: "docs.postman-garage.test",
        supportedRegions: ["Europe"],
        languages: ["fr"],
        industries: ["Automobile"],
        categories: ["Gestion de garage"],
        officialWebsite: "https://docs.postman-garage.test/",
      },
    );
    await services.decideSoftwareDomain(admin.id, tenant.id, {
      domainId: software.domainId,
      status: "approved",
      reason: "Domaine officiel verifie.",
    });
    const api = await services.createApiProductRecord(admin.id, tenant.id, {
      softwareId: software.softwareId,
      name: "Garage Cloud API Postman",
      apiStyle: "rest",
      version: "2.4",
      documentationUrl: "https://docs.postman-garage.test/reference",
    });
    await expect(
      services.addOfficialApiSource(admin.id, tenant.id, {
        softwareId: software.softwareId,
        apiProductId: api.apiProductId,
        url: "https://docs.postman-garage.test/community.json",
        sourceType: "third_party_reference",
      }),
    ).rejects.toMatchObject({ code: "source_not_official" });
    const source = await services.addOfficialApiSource(admin.id, tenant.id, {
      softwareId: software.softwareId,
      apiProductId: api.apiProductId,
      url: "https://docs.postman-garage.test/garage.postman_collection.json",
      sourceType: "official_postman_collection",
    });
    const snapshot = await services.fetchApprovedApiSource(
      admin.id,
      tenant.id,
      source.sourceId,
    );
    for (const secret of [
      "postman-access-secret",
      "postman-variable-secret",
      "folder-bearer-secret",
      "query-secret",
      "request-secret",
      "body-secret",
      "response-secret",
      "client@example.com",
      "globalThis.__postmanScriptExecuted",
    ]) {
      expect(snapshot.content).not.toContain(secret);
    }

    const preview = await services.previewApiSnapshot(admin.id, tenant.id, {
      snapshotId: snapshot.id,
      apiProductId: api.apiProductId,
    });
    expect(preview.parserVersion).toBe("postman-1");
    if (preview.parserVersion !== "postman-1") {
      throw new Error("Apercu Postman attendu.");
    }
    expect(preview.operations).toHaveLength(3);
    expect(preview.variables).toHaveLength(4);
    expect(preview.examples).toHaveLength(2);
    expect(preview.blockedScriptCount).toBe(2);

    const imported = await services.persistApiPreview(
      admin.id,
      tenant.id,
      preview,
    );
    expect(imported).toMatchObject({
      operationCount: 3,
      schemaCount: 0,
      blockedScriptCount: 2,
    });
    expect(imported.claimIds).toHaveLength(4);

    const product = await db.query<{
      postman_collection_url: string | null;
      openapi_url: string | null;
      authentication_type: string;
    }>(
      `select postman_collection_url, openapi_url, authentication_type
       from api_products where id = $1`,
      [api.apiProductId],
    );
    expect(product.rows).toEqual([
      {
        postman_collection_url:
          "https://docs.postman-garage.test/garage.postman_collection.json",
        openapi_url: null,
        authentication_type: "mixed",
      },
    ]);
    const claims = await db.query<{
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
    expect(claims.rows.map((claim) => claim.approval_status)).toEqual([
      "under_review",
      "under_review",
      "under_review",
      "under_review",
    ]);
    expect(claims.rows.map((claim) => claim.locator)).toEqual([
      "#",
      "#/item/0/item/0",
      "#/item/0/item/1",
      "#/item/1",
    ]);
    const persistedClaims = JSON.stringify(claims.rows);
    expect(persistedClaims).not.toContain("postman-variable-secret");
    expect(persistedClaims).not.toContain("pm.test");

    for (const claimId of imported.claimIds) {
      await services.decideApiClaim(admin.id, tenant.id, {
        claimId,
        status: "approved",
        reason: "Source Postman officielle verifiee.",
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
    expect(compatibility.outcome).toBe("configuration_required");
    expect(compatibility.readableOperations).toHaveLength(2);
    expect(compatibility.writableOperations).toHaveLength(1);
    expect(compatibility.evidence.map((evidence) => evidence.locator)).toEqual([
      "#",
      "#/item/0/item/0",
      "#/item/0/item/1",
      "#/item/1",
    ]);

    serveChangedPostman = true;
    const changedSnapshot = await services.fetchApprovedApiSource(
      admin.id,
      tenant.id,
      source.sourceId,
    );
    expect(changedSnapshot.id).not.toBe(snapshot.id);
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
          target: "post:/contacts",
        }),
      ]),
    });

    const openApiSource = await services.addOfficialApiSource(
      admin.id,
      tenant.id,
      {
        softwareId: software.softwareId,
        apiProductId: api.apiProductId,
        url: "https://docs.postman-garage.test/openapi.json",
        sourceType: "official_openapi_specification",
      },
    );
    const openApiSnapshot = await services.fetchApprovedApiSource(
      admin.id,
      tenant.id,
      openApiSource.sourceId,
    );
    const openApiPreview = await services.previewOpenApiSnapshot(
      admin.id,
      tenant.id,
      {
        snapshotId: openApiSnapshot.id,
        apiProductId: api.apiProductId,
      },
    );
    await expect(
      services.persistOpenApiPreview(
        admin.id,
        tenant.id,
        openApiPreview,
      ),
    ).rejects.toMatchObject({ code: "source_type_conflict" });
    const remainingOperations = await db.query<{ count: number }>(
      "select count(*)::int as count from api_operations where api_product_id = $1",
      [api.apiProductId],
    );
    expect(remainingOperations.rows[0]?.count).toBe(3);

    const audit = await db.query<{ action: string; metadata: string }>(
      `select action, metadata from audit_logs
       where tenant_id = $1 and action = 'api_intelligence.postman_imported'`,
      [tenant.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.metadata).not.toContain("secret");
  });
});

async function fixture(name: string) {
  return readFile(path.join(process.cwd(), "tests", "fixtures", name), "utf8");
}
