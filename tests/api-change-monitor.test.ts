import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareApiSnapshots,
  previewOpenApiDocument,
} from "../src/modules/api-intelligence";

describe("API Change Monitor", () => {
  it("classifies source, contract, security, schema and access changes", async () => {
    const previousContent = await fixture("mock-garage-openapi.json");
    const currentContent = await fixture("mock-garage-openapi-breaking.json");
    const previousHash = digest(previousContent);
    const currentHash = digest(currentContent);
    const previousPreview = previewOpenApiDocument({
      snapshotId: "snapshot_previous",
      apiProductId: "api_garage",
      sourceHash: previousHash,
      content: previousContent,
      contentType: "application/json",
    });
    const currentPreview = previewOpenApiDocument({
      snapshotId: "snapshot_current",
      apiProductId: "api_garage",
      sourceHash: currentHash,
      content: currentContent,
      contentType: "application/json",
    });

    const comparison = compareApiSnapshots({
      previous: {
        contentHash: previousHash,
        etag: '"v1"',
        lastModified: "Sun, 12 Jul 2026 00:00:00 GMT",
        accessPolicyDecision: "allowed",
        robotsDecision: "allowed",
        preview: previousPreview,
      },
      current: {
        contentHash: currentHash,
        etag: '"v2"',
        lastModified: "Mon, 13 Jul 2026 00:00:00 GMT",
        accessPolicyDecision: "approved_domain_only",
        robotsDecision: "allowed",
        preview: currentPreview,
      },
    });

    expect(comparison.primaryClassification).toBe("access_policy_change");
    expect(comparison.requiresApproval).toBe(true);
    expect(
      comparison.summary.changes.map((change) => change.kind),
    ).toEqual(
      expect.arrayContaining([
        "source_content_changed",
        "etag_changed",
        "last_modified_changed",
        "access_policy_changed",
        "endpoint_removed",
        "schema_changed",
        "authentication_changed",
        "scopes_changed",
        "webhook_support_changed",
        "api_version_changed",
        "base_url_changed",
        "rate_limit_changed",
      ]),
    );
    expect(
      comparison.summary.changes.find(
        (change) => change.kind === "endpoint_removed",
      ),
    ).toMatchObject({ target: "listCustomers", classification: "breaking" });
  });

  it("treats a newly unreadable specification as a breaking change", () => {
    const comparison = compareApiSnapshots({
      previous: {
        contentHash: "a".repeat(64),
        accessPolicyDecision: "allowed",
        robotsDecision: "allowed",
      },
      current: {
        contentHash: "b".repeat(64),
        accessPolicyDecision: "allowed",
        robotsDecision: "allowed",
        parseFailed: true,
      },
    });

    expect(comparison.primaryClassification).toBe("breaking");
    expect(comparison.summary.changes).toContainEqual(
      expect.objectContaining({ kind: "specification_unreadable" }),
    );
  });
});

async function fixture(name: string) {
  return readFile(path.join(process.cwd(), "tests", "fixtures", name), "utf8");
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
