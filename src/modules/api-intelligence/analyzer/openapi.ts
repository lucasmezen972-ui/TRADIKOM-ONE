import { parseDocument } from "yaml";
import { AnalyzerError } from "@/modules/api-intelligence/analyzer/errors";
import {
  openApiDocumentSchema,
  openApiPreviewSchema,
  type OpenApiPreview,
} from "@/modules/api-intelligence/analyzer/schemas";

const maxDocumentBytes = 1024 * 1024;
const maxDepth = 40;
const maxReferences = 500;
const methods = ["get", "post", "put", "patch", "delete", "options", "head"];

export function previewOpenApiDocument(input: {
  snapshotId: string;
  apiProductId: string;
  sourceHash: string;
  content: string;
  contentType?: string;
}): OpenApiPreview {
  if (Buffer.byteLength(input.content) > maxDocumentBytes) {
    throw new AnalyzerError("document_too_complex", "Document OpenAPI trop volumineux.");
  }
  const raw = parseDeterministicDocument(input.content, input.contentType);
  assertBoundedDocument(raw);
  const parsed = openApiDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AnalyzerError("openapi_invalid", "Document OpenAPI invalide.");
  }
  const document = parsed.data;
  const references = collectReferences(document);
  if (references.some((reference) => !reference.startsWith("#/"))) {
    throw new AnalyzerError(
      "external_reference_blocked",
      "Les references OpenAPI externes sont bloquees.",
    );
  }
  if (references.length > maxReferences) {
    throw new AnalyzerError(
      "document_too_complex",
      "Trop de references OpenAPI.",
    );
  }

  const securitySchemes = document.components?.securitySchemes ?? {};
  const auth = extractAuthentication(securitySchemes);
  const operations = Object.entries(document.paths).flatMap(([path, pathItem]) =>
    methods.flatMap((method) => {
      const operation = pathItem[method];
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
        return [];
      }
      const value = operation as Record<string, unknown>;
      const operationKey =
        typeof value.operationId === "string" && value.operationId.trim()
          ? value.operationId.trim()
          : `${method}:${path}`;
      return [
        {
          operationKey,
          method: method.toUpperCase(),
          path,
          summary: typeof value.summary === "string" ? value.summary : "",
          tags: Array.isArray(value.tags)
            ? value.tags.filter((tag): tag is string => typeof tag === "string")
            : [],
          capability: method === "get" || method === "head" ? "read" as const : "write" as const,
          deprecated: value.deprecated === true,
          requestSchemaRef: findSchemaReference(value.requestBody),
          responseSchemaRef: findSuccessResponseSchema(value.responses),
          securityRequirements: normalizeSecurityRequirements(
            value.security ?? pathItem.security ?? [],
          ),
        },
      ];
    }),
  );
  const schemas = Object.entries(document.components?.schemas ?? {}).map(
    ([name, schema]) => ({ name, document: stripSensitiveExamples(schema) }),
  );
  const baseUrl = document.servers?.[0]?.url;
  const preview = {
    parserVersion: "openapi-1" as const,
    snapshotId: input.snapshotId,
    apiProductId: input.apiProductId,
    sourceHash: input.sourceHash,
    title: document.info.title,
    version: document.info.version,
    baseUrl: typeof baseUrl === "string" ? baseUrl : undefined,
    authenticationType: auth.type,
    oauthMetadata: auth.metadata,
    scopes: auth.scopes,
    webhookSupport: Boolean(document.webhooks),
    operations,
    schemas,
    blockedExternalReferences: 0 as const,
  };
  return openApiPreviewSchema.parse(preview);
}

function parseDeterministicDocument(content: string, contentType?: string) {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || contentType?.includes("json")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      throw new AnalyzerError("openapi_invalid", "JSON OpenAPI invalide.");
    }
  }
  try {
    const document = parseDocument(trimmed, {
      strict: true,
      uniqueKeys: true,
    });
    if (document.errors.length > 0) {
      throw new Error("invalid yaml");
    }
    return document.toJS({ maxAliasCount: 20 }) as unknown;
  } catch {
    throw new AnalyzerError("openapi_invalid", "YAML OpenAPI invalide.");
  }
}

function assertBoundedDocument(value: unknown, depth = 0, seen = new Set<unknown>()) {
  if (depth > maxDepth) {
    throw new AnalyzerError("document_too_complex", "Document OpenAPI trop profond.");
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) {
    throw new AnalyzerError("document_too_complex", "Structure OpenAPI recursive refusee.");
  }
  seen.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    assertBoundedDocument(child, depth + 1, seen);
  }
  seen.delete(value);
}

function collectReferences(value: unknown, references: string[] = []) {
  if (Array.isArray(value)) {
    value.forEach((child) => collectReferences(child, references));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => {
      if (key === "$ref" && typeof child === "string") references.push(child);
      else collectReferences(child, references);
    });
  }
  return references;
}

function findSchemaReference(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.$ref === "string") return record.$ref;
  for (const child of Object.values(record)) {
    const found = findSchemaReference(child);
    if (found) return found;
  }
  return undefined;
}

function findSuccessResponseSchema(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const responses = value as Record<string, unknown>;
  const success = Object.entries(responses).find(([status]) => /^2\d\d$/.test(status));
  return success ? findSchemaReference(success[1]) : undefined;
}

function normalizeSecurityRequirements(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    return [
      Object.fromEntries(
        Object.entries(entry).map(([key, scopes]) => [
          key,
          Array.isArray(scopes)
            ? scopes.filter((scope): scope is string => typeof scope === "string")
            : [],
        ]),
      ),
    ];
  });
}

function extractAuthentication(schemes: Record<string, unknown>) {
  const entries = Object.entries(schemes);
  const oauth = entries.find(([, value]) =>
    value && typeof value === "object" && (value as Record<string, unknown>).type === "oauth2",
  );
  if (oauth) {
    const definition = oauth[1] as Record<string, unknown>;
    const flows =
      definition.flows && typeof definition.flows === "object"
        ? (definition.flows as Record<string, unknown>)
        : {};
    const scopes = new Set<string>();
    for (const flow of Object.values(flows)) {
      if (!flow || typeof flow !== "object") continue;
      const flowScopes = (flow as Record<string, unknown>).scopes;
      if (!flowScopes || typeof flowScopes !== "object") continue;
      Object.keys(flowScopes).forEach((scope) => scopes.add(scope));
    }
    return {
      type: "oauth2",
      metadata: stripSensitiveExamples({ scheme: oauth[0], flows }) as Record<string, unknown>,
      scopes: [...scopes].sort(),
    };
  }
  const first = entries[0];
  if (!first || !first[1] || typeof first[1] !== "object") {
    return { type: "none", metadata: {}, scopes: [] as string[] };
  }
  const definition = first[1] as Record<string, unknown>;
  return {
    type: typeof definition.type === "string" ? definition.type : "unknown",
    metadata: { scheme: first[0], in: definition.in, name: definition.name },
    scopes: [] as string[],
  };
}

function stripSensitiveExamples(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitiveExamples);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["example", "examples", "default"].includes(key))
      .map(([key, child]) => [key, stripSensitiveExamples(child)]),
  );
}
