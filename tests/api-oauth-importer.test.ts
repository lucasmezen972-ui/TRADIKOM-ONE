import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { setPlatformRole } from "../src/modules/platform-admin";

const databases: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("OAuth authorization server metadata import", () => {
  it("augments an API product without replacing operations and monitors scope removal", async () => {
    const db = await createMemoryDb();
    databases.push(db);
    const openApi = await fixture("mock-garage-openapi.json");
    const oauth = await fixture("mock-garage-oauth-metadata.json");
    const changedDocument = JSON.parse(oauth) as {
      scopes_supported: string[];
    };
    changedDocument.scopes_supported = changedDocument.scopes_supported.filter(
      (scope) => scope !== "contacts:write",
    );
    const changedOauth = JSON.stringify(changedDocument);
    let serveChangedOauth = false;
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
            : serveChangedOauth
              ? changedOauth
              : oauth,
        };
      },
    });
    const admin = await services.registerUser({
      name: "Admin OAuth",
      email: "oauth-admin@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(admin.id, {
      name: "Garage OAuth",
      category: "Garage automobile",
    });
    await setPlatformRole(db, admin.id, "platform_admin");
    const software = await services.createSoftwareDirectoryEntry(
      admin.id,
      tenant.id,
      {
        canonicalName: "Garage Cloud OAuth",
        aliases: [],
        vendor: "Garage Cloud SAS",
        officialDomain: "docs.oauth-garage.test",
        supportedRegions: ["Europe"],
        languages: ["fr"],
        industries: ["Automobile"],
        categories: ["Gestion de garage"],
        officialWebsite: "https://docs.oauth-garage.test/",
      },
    );
    await services.decideSoftwareDomain(admin.id, tenant.id, {
      domainId: software.domainId,
      status: "approved",
      reason: "Domaine officiel verifie.",
    });
    const api = await services.createApiProductRecord(admin.id, tenant.id, {
      softwareId: software.softwareId,
      name: "Garage Cloud API OAuth",
      apiStyle: "rest",
      version: "2.4",
      documentationUrl: "https://docs.oauth-garage.test/reference",
    });

    const openApiSource = await services.addOfficialApiSource(
      admin.id,
      tenant.id,
      {
        softwareId: software.softwareId,
        apiProductId: api.apiProductId,
        url: "https://docs.oauth-garage.test/openapi.json",
        sourceType: "official_openapi_specification",
      },
    );
    const openApiSnapshot = await services.fetchApprovedApiSource(
      admin.id,
      tenant.id,
      openApiSource.sourceId,
    );
    const openApiPreview = await services.previewApiSnapshot(
      admin.id,
      tenant.id,
      { snapshotId: openApiSnapshot.id, apiProductId: api.apiProductId },
    );
    await services.persistApiPreview(admin.id, tenant.id, openApiPreview);

    const oauthSource = await services.addOfficialApiSource(
      admin.id,
      tenant.id,
      {
        softwareId: software.softwareId,
        apiProductId: api.apiProductId,
        url: "https://docs.oauth-garage.test/.well-known/oauth-authorization-server",
        sourceType: "official_oauth_metadata",
      },
    );
    const oauthSnapshot = await services.fetchApprovedApiSource(
      admin.id,
      tenant.id,
      oauthSource.sourceId,
    );
    expect(oauthSnapshot.content).not.toContain("oauth-fixture-secret");
    const preview = await services.previewApiSnapshot(admin.id, tenant.id, {
      snapshotId: oauthSnapshot.id,
      apiProductId: api.apiProductId,
    });
    expect(preview.parserVersion).toBe("oauth-metadata-1");
    if (preview.parserVersion !== "oauth-metadata-1") {
      throw new Error("Apercu OAuth attendu.");
    }
    expect(preview).toMatchObject({
      pkceS256Supported: true,
      revocationEndpoint: "https://auth.garage-cloud.test/oauth2/revoke",
    });

    const beforeImport = await operationCount(db, api.apiProductId);
    const imported = await services.persistApiPreview(admin.id, tenant.id, preview);
    expect(imported).toMatchObject({ operationCount: 0, schemaCount: 0 });
    expect(imported.claimIds).toHaveLength(1);
    expect(await operationCount(db, api.apiProductId)).toBe(beforeImport);

    const product = await db.query<{
      authentication_type: string;
      oauth_metadata: string;
      scopes: string;
    }>(
      `select authentication_type, oauth_metadata, scopes
       from api_products where id = $1`,
      [api.apiProductId],
    );
    expect(product.rows[0]?.authentication_type).toBe("oauth2");
    expect(JSON.parse(product.rows[0]?.scopes ?? "[]")).toEqual([
      "contacts:read",
      "contacts:write",
      "offline_access",
    ]);
    const storedMetadata = product.rows[0]?.oauth_metadata ?? "";
    expect(storedMetadata).toContain("pkceS256Supported");
    expect(storedMetadata).not.toContain("oauth-fixture-secret");
    expect(storedMetadata).not.toContain("header.payload.signature");

    await services.persistApiPreview(admin.id, tenant.id, openApiPreview);
    expect(await operationCount(db, api.apiProductId)).toBe(beforeImport);
    const metadataAfterContractReimport = await db.query<{
      oauth_metadata: string;
    }>("select oauth_metadata from api_products where id = $1", [api.apiProductId]);
    expect(metadataAfterContractReimport.rows[0]?.oauth_metadata).toBe(
      storedMetadata,
    );
    const oauthClaim = await db.query<{ approval_status: string }>(
      `select approval_status from api_claims
       where id = $1 and source_snapshot_id = $2`,
      [imported.claimIds[0], oauthSnapshot.id],
    );
    expect(oauthClaim.rows).toEqual([{ approval_status: "under_review" }]);

    serveChangedOauth = true;
    await services.fetchApprovedApiSource(
      admin.id,
      tenant.id,
      oauthSource.sourceId,
    );
    const change = await db.query<{
      primary_classification: string;
      summary: string;
    }>(
      `select primary_classification, summary from api_change_events
       where source_id = $1`,
      [oauthSource.sourceId],
    );
    expect(change.rows).toHaveLength(1);
    expect(change.rows[0]?.primary_classification).toBe("breaking");
    expect(JSON.parse(change.rows[0]?.summary ?? "{}")).toMatchObject({
      changes: expect.arrayContaining([
        expect.objectContaining({ kind: "scopes_changed" }),
      ]),
    });

    const audit = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1
         and action = 'api_intelligence.oauth_metadata_imported'`,
      [tenant.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.safe_metadata).not.toContain("secret");
  });
});

async function operationCount(
  db: DbClient,
  apiProductId: string,
) {
  const result = await db.query<{ count: number }>(
    "select count(*)::int as count from api_operations where api_product_id = $1",
    [apiProductId],
  );
  return result.rows[0]?.count ?? 0;
}

async function fixture(name: string) {
  return readFile(path.join(process.cwd(), "tests", "fixtures", name), "utf8");
}
