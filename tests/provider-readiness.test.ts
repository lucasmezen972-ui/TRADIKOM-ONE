import { describe, expect, it } from "vitest";
import {
  classifyCloudflareFailure,
  cloudflareReadOnlyContract,
  createCloudflareRequestPlan,
  parseCloudflareDnsRecords,
  parseCloudflareTokenVerification,
  parseCloudflareZones,
} from "../src/modules/provider-readiness";

const excludedCredentialMarker = "credential-should-not-appear";
const zoneId = "023e105f4ecef8ad9ca31a8372d0c353";

describe("Cloudflare provider readiness", () => {
  it("exposes only the three reviewed GET capabilities", () => {
    expect(cloudflareReadOnlyContract.activationStatus).toBe("contract_only");
    expect(cloudflareReadOnlyContract.capabilities).toMatchObject({
      tokenVerification: true,
      zoneListing: true,
      dnsRecordListing: true,
      writes: false,
      dnsChanges: false,
      automaticActivation: false,
      credentialMaterialization: false,
      networkTransport: false,
    });
    expect(cloudflareReadOnlyContract.operations).toHaveLength(3);
    expect(
      cloudflareReadOnlyContract.operations.every(
        (operation) => operation.method === "GET",
      ),
    ).toBe(true);
    expect(
      cloudflareReadOnlyContract.operations.map((operation) => operation.key),
    ).toEqual(["token.verify", "zones.list", "dns.records.list"]);
  });

  it("builds fixed-origin bounded request plans without credentials or transport", () => {
    const zones = createCloudflareRequestPlan({
      operation: "zones.list",
      zoneName: "Example.COM.",
      page: 2,
      perPage: 25,
    });
    expect(zones).toMatchObject({
      method: "GET",
      timeoutMs: 10_000,
      maxResponseBytes: 512 * 1024,
      safeSummary: {
        page: 2,
        perPage: 25,
        credentialIncluded: false,
        transportEnabled: false,
      },
    });
    expect(zones.url).toBe(
      "https://api.cloudflare.com/client/v4/zones?page=2&per_page=25&name=example.com",
    );
    expect(JSON.stringify(zones)).not.toContain(excludedCredentialMarker);

    const tokenVerification = createCloudflareRequestPlan({
      operation: "token.verify",
    });
    expect(tokenVerification.url).toBe(
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
    );
    expect(tokenVerification.safeSummary).toMatchObject({
      credentialIncluded: false,
      transportEnabled: false,
    });

    const records = createCloudflareRequestPlan({
      operation: "dns.records.list",
      zoneId: zoneId.toUpperCase(),
    });
    expect(records.url).toBe(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?page=1&per_page=50`,
    );
    expect(records.safeSummary.zoneIdPresent).toBe(true);
  });

  it("rejects unbounded pagination, invalid domains and invalid identifiers", () => {
    expect(() =>
      createCloudflareRequestPlan({ operation: "zones.list", page: 11 }),
    ).toThrow("Cloudflare page is outside the allowed range.");
    expect(() =>
      createCloudflareRequestPlan({
        operation: "zones.list",
        zoneName: "http://example.com",
      }),
    ).toThrow("Cloudflare zone name is invalid.");
    expect(() =>
      createCloudflareRequestPlan({
        operation: "dns.records.list",
        zoneId: "../user/tokens/verify",
      }),
    ).toThrow("Cloudflare zoneId is invalid.");
  });

  it("reduces token verification to bounded non-secret metadata", () => {
    expect(
      parseCloudflareTokenVerification({
        success: true,
        result: {
          id: zoneId,
          status: "active",
          expires_on: "2027-01-01T00:00:00Z",
        },
      }),
    ).toEqual({
      id: zoneId,
      status: "active",
      expiresOn: "2027-01-01T00:00:00.000Z",
      notBefore: null,
    });

    expect(() =>
      parseCloudflareTokenVerification({
        success: false,
        errors: [{ message: excludedCredentialMarker }],
      }),
    ).toThrow("Cloudflare response is invalid.");
  });

  it("maps only the reviewed zone and DNS record fields", () => {
    const zones = parseCloudflareZones({
      success: true,
      result: [
        {
          id: zoneId,
          name: "Example.COM",
          status: "active",
          type: "full",
          account: {
            id: "8a7806b7e0b447c4a98b6e7a95f7f0aa",
            name: "Secret account label",
          },
          owner: { email: "owner@example.com" },
        },
      ],
    });
    expect(zones).toEqual([
      {
        id: zoneId,
        name: "example.com",
        status: "active",
        type: "full",
        accountId: "8a7806b7e0b447c4a98b6e7a95f7f0aa",
      },
    ]);
    expect(JSON.stringify(zones)).not.toContain("owner@example.com");
    expect(JSON.stringify(zones)).not.toContain("Secret account label");

    const records = parseCloudflareDnsRecords({
      success: true,
      result: [
        {
          id: "372e67954025e0ba6aaa6d586b9e0b59",
          type: "a",
          name: "WWW.Example.COM",
          content: "203.0.113.10",
          ttl: 300,
          proxied: true,
          comment: "not returned",
          tags: ["private:value"],
        },
      ],
    });
    expect(records).toEqual([
      {
        id: "372e67954025e0ba6aaa6d586b9e0b59",
        type: "A",
        name: "www.example.com",
        content: "203.0.113.10",
        ttl: 300,
        proxied: true,
      },
    ]);
    expect(JSON.stringify(records)).not.toContain("private:value");
    expect(JSON.stringify(records)).not.toContain("not returned");
  });

  it("rejects oversized result sets and classifies failures without provider bodies", () => {
    expect(() =>
      parseCloudflareZones({
        success: true,
        result: Array.from({ length: 51 }, () => ({
          id: zoneId,
          name: "example.com",
        })),
      }),
    ).toThrow("Cloudflare response is invalid.");

    expect(classifyCloudflareFailure({ status: 401 })).toEqual({
      classification: "authentication_required",
      retryable: false,
      status: 401,
    });
    expect(classifyCloudflareFailure({ status: 429 })).toEqual({
      classification: "rate_limited",
      retryable: true,
      status: 429,
    });
    expect(classifyCloudflareFailure({ kind: "timeout" })).toEqual({
      classification: "provider_unavailable",
      retryable: true,
      status: null,
    });
  });
});
