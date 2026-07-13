import { createHash } from "node:crypto";
import type { OpenApiPreview } from "@/modules/api-intelligence/analyzer";
import {
  apiChangeSummarySchema,
  type ApiChangeClassification,
  type ApiChangeItem,
} from "@/modules/api-intelligence/change-monitor/schemas";

export type ApiSnapshotDescriptor = {
  contentHash: string;
  etag?: string;
  lastModified?: string;
  accessPolicyDecision: string;
  robotsDecision: string;
  preview?: OpenApiPreview;
  parseFailed?: boolean;
};

const classificationRank: Record<ApiChangeClassification, number> = {
  informational: 0,
  additive: 1,
  potentially_breaking: 2,
  security_relevant: 3,
  breaking: 4,
  access_policy_change: 5,
};

export function compareApiSnapshots(input: {
  previous: ApiSnapshotDescriptor;
  current: ApiSnapshotDescriptor;
}) {
  const changes: ApiChangeItem[] = [];
  const { previous, current } = input;

  if (previous.contentHash !== current.contentHash) {
    changes.push(change("source_content_changed", "informational"));
  }
  if (previous.etag !== current.etag) {
    changes.push(change("etag_changed", "informational"));
  }
  if (previous.lastModified !== current.lastModified) {
    changes.push(change("last_modified_changed", "informational"));
  }
  if (
    previous.accessPolicyDecision !== current.accessPolicyDecision ||
    previous.robotsDecision !== current.robotsDecision
  ) {
    changes.push(change("access_policy_changed", "access_policy_change"));
  }

  if (current.parseFailed) {
    changes.push(change("specification_unreadable", "breaking"));
  } else if (previous.parseFailed && current.preview) {
    changes.push(change("specification_readable", "informational"));
  }

  if (previous.preview && current.preview) {
    compareProductMetadata(previous.preview, current.preview, changes);
    compareOperations(previous.preview, current.preview, changes);
    compareSchemas(previous.preview, current.preview, changes);
  }

  const ordered = changes.sort((left, right) =>
    `${left.kind}:${left.target ?? ""}`.localeCompare(
      `${right.kind}:${right.target ?? ""}`,
    ),
  );
  const classifications = [...new Set(ordered.map((item) => item.classification))]
    .sort((left, right) => classificationRank[right] - classificationRank[left]);
  const primaryClassification = classifications[0] ?? "informational";
  const requiresApproval = ordered.some((item) =>
    ["breaking", "security_relevant", "access_policy_change"].includes(
      item.classification,
    ),
  );
  const summary = apiChangeSummarySchema.parse({
    monitorVersion: "api-change-1",
    previousApiVersion: previous.preview?.version,
    currentApiVersion: current.preview?.version,
    changes: ordered,
  });

  return {
    primaryClassification,
    classifications: classifications.length > 0
      ? classifications
      : ["informational" as const],
    requiresApproval,
    summary,
  };
}

function compareProductMetadata(
  previous: OpenApiPreview,
  current: OpenApiPreview,
  changes: ApiChangeItem[],
) {
  if (
    previous.authenticationType !== current.authenticationType ||
    fingerprint(previous.oauthMetadata) !== fingerprint(current.oauthMetadata)
  ) {
    changes.push(change("authentication_changed", "security_relevant"));
  }

  const previousScopes = new Set(previous.scopes);
  const currentScopes = new Set(current.scopes);
  const addedScopes = current.scopes.filter((scope) => !previousScopes.has(scope));
  const removedScopes = previous.scopes.filter((scope) => !currentScopes.has(scope));
  if (addedScopes.length > 0 || removedScopes.length > 0) {
    changes.push(
      change(
        "scopes_changed",
        removedScopes.length > 0 ? "breaking" : "security_relevant",
        undefined,
        { added: addedScopes.sort(), removed: removedScopes.sort() },
      ),
    );
  }

  if (previous.webhookSupport !== current.webhookSupport) {
    changes.push(
      change(
        "webhook_support_changed",
        current.webhookSupport ? "additive" : "breaking",
      ),
    );
  }
  if (previous.version !== current.version) {
    changes.push(
      change("api_version_changed", "informational", undefined, {
        previous: previous.version,
        current: current.version,
      }),
    );
  }
  if (previous.baseUrl !== current.baseUrl) {
    changes.push(change("base_url_changed", "potentially_breaking"));
  }
  if (previous.rateLimitFingerprint !== current.rateLimitFingerprint) {
    changes.push(change("rate_limit_changed", "potentially_breaking"));
  }
}

function compareOperations(
  previous: OpenApiPreview,
  current: OpenApiPreview,
  changes: ApiChangeItem[],
) {
  const before = new Map(previous.operations.map((item) => [item.operationKey, item]));
  const after = new Map(current.operations.map((item) => [item.operationKey, item]));

  for (const [operationKey, operation] of after) {
    if (!before.has(operationKey)) {
      changes.push(
        change("endpoint_added", "additive", operationKey, {
          method: operation.method,
          path: operation.path,
        }),
      );
    }
  }
  for (const [operationKey, operation] of before) {
    const next = after.get(operationKey);
    if (!next) {
      changes.push(
        change("endpoint_removed", "breaking", operationKey, {
          method: operation.method,
          path: operation.path,
        }),
      );
      continue;
    }
    if (operation.method !== next.method || operation.path !== next.path) {
      changes.push(change("endpoint_signature_changed", "breaking", operationKey));
    }
    if (
      operation.requestSchemaRef !== next.requestSchemaRef ||
      operation.responseSchemaRef !== next.responseSchemaRef
    ) {
      changes.push(
        change("operation_schema_changed", "potentially_breaking", operationKey),
      );
    }
    if (
      fingerprint(operation.securityRequirements) !==
      fingerprint(next.securityRequirements)
    ) {
      changes.push(
        change("operation_security_changed", "security_relevant", operationKey),
      );
    }
    if (operation.deprecated !== next.deprecated) {
      changes.push(
        change(
          "deprecation_changed",
          next.deprecated ? "potentially_breaking" : "informational",
          operationKey,
          { deprecated: next.deprecated },
        ),
      );
    }
  }
}

function compareSchemas(
  previous: OpenApiPreview,
  current: OpenApiPreview,
  changes: ApiChangeItem[],
) {
  const before = new Map(previous.schemas.map((item) => [item.name, item.document]));
  const after = new Map(current.schemas.map((item) => [item.name, item.document]));
  for (const [name, document] of after) {
    if (!before.has(name)) {
      changes.push(change("schema_added", "additive", name));
    } else if (fingerprint(before.get(name)) !== fingerprint(document)) {
      changes.push(change("schema_changed", "potentially_breaking", name));
    }
  }
  for (const name of before.keys()) {
    if (!after.has(name)) {
      changes.push(change("schema_removed", "breaking", name));
    }
  }
}

function change(
  kind: ApiChangeItem["kind"],
  classification: ApiChangeClassification,
  target?: string,
  details?: ApiChangeItem["details"],
): ApiChangeItem {
  return { kind, classification, target, details };
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
