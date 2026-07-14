import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import type { DiscoveryTransport } from "../src/modules/api-intelligence";
import { setPlatformRole } from "../src/modules/platform-admin";

const databases: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("approved-domain expansion", () => {
  it("discovers bounded candidates and requires a reviewed source decision", async () => {
    const db = await createMemoryDb();
    databases.push(db);
    let documentRequests = 0;
    const transport: DiscoveryTransport = async (url) => {
      if (url.pathname === "/robots.txt") {
        return {
          status: 200,
          headers: { "content-type": "text/plain" },
          body: [
            "User-agent: TradikomApiScout",
            "Allow: /",
            "Sitemap: https://docs.scan-garage.test/sitemap-index.xml",
            "Sitemap: https://outside.test/sitemap.xml",
          ].join("\n"),
        };
      }
      documentRequests += 1;
      if (url.pathname === "/sitemap-index.xml") {
        return xml(`
          <sitemapindex>
            <sitemap><loc>https://docs.scan-garage.test/sitemap-api.xml</loc></sitemap>
            <sitemap><loc>https://outside.test/hidden.xml</loc></sitemap>
          </sitemapindex>`);
      }
      if (url.pathname === "/sitemap-api.xml") {
        return xml(`
          <urlset>
            <url><loc>https://docs.scan-garage.test/spec/openapi.json?utm_source=map</loc></url>
            <url><loc>https://docs.scan-garage.test/.well-known/openid-configuration</loc></url>
            <url><loc>https://docs.scan-garage.test/changelog</loc></url>
            <url><loc>https://docs.scan-garage.test/api/reference</loc></url>
            <url><loc>https://docs.scan-garage.test/about</loc></url>
            <url><loc>https://sub.docs.scan-garage.test/openapi.json</loc></url>
            <url><loc>https://docs.scan-garage.test/spec/openapi.json?utm_source=map</loc></url>
          </urlset>`);
      }
      return { status: 404, headers: {}, body: "" };
    };
    const services = createServices(db, { discoveryTransport: transport });
    const admin = await services.registerUser({
      name: "Admin scan",
      email: "scan-admin@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(admin.id, {
      name: "Garage scan",
      category: "Garage automobile",
    });
    await setPlatformRole(db, admin.id, "platform_admin");
    const software = await services.createSoftwareDirectoryEntry(
      admin.id,
      tenant.id,
      {
        canonicalName: "Garage Sitemap",
        aliases: [],
        vendor: "Garage Sitemap SAS",
        officialDomain: "docs.scan-garage.test",
        supportedRegions: ["Europe"],
        languages: ["fr"],
        industries: ["Automobile"],
        categories: ["Gestion de garage"],
        officialWebsite: "https://docs.scan-garage.test/",
      },
    );
    await services.decideSoftwareDomain(admin.id, tenant.id, {
      domainId: software.domainId,
      status: "approved",
      reason: "Domaine officiel verifie.",
    });
    const product = await services.createApiProductRecord(admin.id, tenant.id, {
      softwareId: software.softwareId,
      name: "Garage Sitemap API",
      apiStyle: "rest",
      version: "1.0",
      documentationUrl: "https://docs.scan-garage.test/api/reference",
    });

    const viewer = await services.registerUser({
      name: "Lecteur scan",
      email: "scan-viewer@example.com",
      password: "Password!1",
    });
    const viewerTenant = await services.createTenant(viewer.id, {
      name: "Tenant lecteur",
      category: "Conseil",
    });
    await expect(
      services.scanApprovedSoftwareDomain(viewer.id, viewerTenant.id, {
        domainId: software.domainId,
      }),
    ).rejects.toBeTruthy();
    expect(documentRequests).toBe(0);

    const scanned = await services.scanApprovedSoftwareDomain(
      admin.id,
      tenant.id,
      { domainId: software.domainId },
    );
    expect(scanned).toMatchObject({
      sitemapCount: 2,
      candidateCount: 4,
      blockedUrlCount: 3,
      truncated: false,
    });
    expect(documentRequests).toBe(2);

    const workspace = await services.getApiIntelligenceWorkspace(
      admin.id,
      tenant.id,
    );
    expect(workspace.discoveryCandidates).toHaveLength(4);
    expect(workspace.discoveryCandidates.map((candidate) => candidate.url)).toContain(
      "https://docs.scan-garage.test/spec/openapi.json",
    );
    expect(workspace.discoveryCandidates.every((candidate) =>
      candidate.status === "under_review"
    )).toBe(true);
    expect(workspace.sources).toHaveLength(0);

    const openApiCandidate = workspace.discoveryCandidates.find(
      (candidate) => candidate.sourceType === "official_openapi_specification",
    )!;
    const accepted = await services.decideApiDiscoveryCandidate(
      admin.id,
      tenant.id,
      {
        candidateId: openApiCandidate.id,
        status: "accepted",
        apiProductId: product.apiProductId,
        reason: "Specification officielle verifiee.",
      },
    );
    expect(accepted.apiSourceId).toBeTruthy();
    const sourceState = await db.query<{ sources: number; snapshots: number }>(
      `select
         (select count(*)::int from api_sources) as sources,
         (select count(*)::int from api_source_snapshots) as snapshots`,
    );
    expect(sourceState.rows[0]).toEqual({ sources: 1, snapshots: 0 });

    const changelogCandidate = workspace.discoveryCandidates.find(
      (candidate) => candidate.sourceType === "official_changelog",
    )!;
    await services.decideApiDiscoveryCandidate(admin.id, tenant.id, {
      candidateId: changelogCandidate.id,
      status: "rejected",
      reason: "Journal hors perimetre du produit API.",
    });

    await services.scanApprovedSoftwareDomain(admin.id, tenant.id, {
      domainId: software.domainId,
    });
    const candidatesAfterRescan = await db.query<{
      status: string;
      count: number;
    }>(
      `select status, count(*)::int as count
       from api_discovery_candidates group by status order by status`,
    );
    expect(candidatesAfterRescan.rows).toEqual([
      { status: "accepted", count: 1 },
      { status: "rejected", count: 1 },
      { status: "under_review", count: 2 },
    ]);
    const audit = await db.query<{ action: string }>(
      `select action from audit_logs
       where tenant_id = $1 and action like 'api_intelligence.%'
       order by created_at asc`,
      [tenant.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "api_intelligence.domain_scanned",
        "api_intelligence.discovery_candidate_accepted",
        "api_intelligence.discovery_candidate_rejected",
      ]),
    );

    await services.decideSoftwareDomain(admin.id, tenant.id, {
      domainId: software.domainId,
      status: "paused",
      reason: "Scan suspendu.",
    });
    const requestsBeforeBlockedScan = documentRequests;
    await expect(
      services.scanApprovedSoftwareDomain(admin.id, tenant.id, {
        domainId: software.domainId,
      }),
    ).rejects.toMatchObject({ code: "domain_not_approved" });
    expect(documentRequests).toBe(requestsBeforeBlockedScan);
  });
});

function xml(body: string) {
  return {
    status: 200,
    headers: { "content-type": "application/xml" },
    body,
  };
}
