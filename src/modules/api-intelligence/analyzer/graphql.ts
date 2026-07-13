import {
  buildASTSchema,
  buildClientSchema,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isScalarType,
  isSpecifiedScalarType,
  isUnionType,
  parse,
  validateSchema,
  type GraphQLNamedType,
  type GraphQLSchema,
  type IntrospectionQuery,
} from "graphql";
import { AnalyzerError } from "@/modules/api-intelligence/analyzer/errors";
import {
  graphQlPreviewSchema,
  type GraphQlPreview,
} from "@/modules/api-intelligence/analyzer/schemas";

const maxDocumentBytes = 1024 * 1024;
const maxDepth = 40;
const maxNodes = 20_000;
const maxTokens = 50_000;
const maxTypes = 500;
const maxFields = 5_000;
const maxArguments = 10_000;
const maxOperations = 500;

export function previewGraphQlDocument(input: {
  snapshotId: string;
  apiProductId: string;
  sourceHash: string;
  content: string;
  title?: string;
  version?: string;
}): GraphQlPreview {
  if (Buffer.byteLength(input.content) > maxDocumentBytes) {
    throw new AnalyzerError("document_too_complex", "Schema GraphQL trop volumineux.");
  }
  const trimmed = input.content.trim();
  if (!trimmed) {
    throw new AnalyzerError("graphql_invalid", "Schema GraphQL vide.");
  }

  const parsed = trimmed.startsWith("{")
    ? parseIntrospection(trimmed)
    : parseSdl(trimmed);
  const errors = validateSchema(parsed.schema);
  if (errors.length > 0) {
    throw new AnalyzerError("graphql_invalid", "Schema GraphQL invalide.");
  }

  const extraction = extractSchema(parsed.schema);
  return graphQlPreviewSchema.parse({
    parserVersion: "graphql-1",
    snapshotId: input.snapshotId,
    apiProductId: input.apiProductId,
    sourceHash: input.sourceHash,
    title: input.title?.trim() || "Schema GraphQL",
    version: input.version?.trim() || "non-specifiee",
    authenticationType: "unknown",
    oauthMetadata: { transport: "graphql" },
    scopes: [],
    webhookSupport: false,
    rateLimitLocators: [],
    operations: extraction.operations,
    schemas: extraction.schemas,
    sourceFormat: parsed.sourceFormat,
    redactedDefaultValueCount: extraction.redactedDefaultValueCount,
  });
}

function parseSdl(content: string) {
  try {
    const document = parse(content, { maxTokens });
    if (document.definitions.length > maxTypes * 3) {
      throw new AnalyzerError("document_too_complex", "Schema GraphQL trop complexe.");
    }
    return {
      schema: buildASTSchema(document),
      sourceFormat: "sdl" as const,
    };
  } catch (error) {
    if (error instanceof AnalyzerError) throw error;
    throw new AnalyzerError("graphql_invalid", "SDL GraphQL invalide.");
  }
}

function parseIntrospection(content: string) {
  try {
    const raw = JSON.parse(content) as unknown;
    assertBoundedJson(raw);
    const envelope = asRecord(raw);
    const result = envelope.data ? asRecord(envelope.data) : envelope;
    if (!result.__schema) {
      throw new AnalyzerError(
        "graphql_invalid",
        "Resultat d'introspection GraphQL invalide.",
      );
    }
    return {
      schema: buildClientSchema(result as unknown as IntrospectionQuery),
      sourceFormat: "introspection" as const,
    };
  } catch (error) {
    if (error instanceof AnalyzerError) throw error;
    throw new AnalyzerError(
      "graphql_invalid",
      "JSON d'introspection GraphQL invalide.",
    );
  }
}

function extractSchema(schema: GraphQLSchema) {
  const namedTypes = Object.values(schema.getTypeMap())
    .filter((type) => !type.name.startsWith("__") && !isSpecifiedScalarType(type))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (namedTypes.length > maxTypes) {
    throw new AnalyzerError("document_too_complex", "Trop de types GraphQL.");
  }

  let fieldCount = 0;
  let argumentCount = 0;
  let redactedDefaultValueCount = 0;
  const schemas = namedTypes.map((type) => {
    const result = describeType(type);
    fieldCount += result.fieldCount;
    argumentCount += result.argumentCount;
    redactedDefaultValueCount += result.redactedDefaultValueCount;
    return {
      name: type.name,
      document: result.document,
      locator: `#/types/${escapeJsonPointer(type.name)}`,
    };
  });
  if (fieldCount > maxFields || argumentCount > maxArguments) {
    throw new AnalyzerError("document_too_complex", "Schema GraphQL trop complexe.");
  }

  const roots = [
    { kind: "query", type: schema.getQueryType(), capability: "read" as const },
    { kind: "mutation", type: schema.getMutationType(), capability: "write" as const },
    { kind: "subscription", type: schema.getSubscriptionType(), capability: "read" as const },
  ];
  const operations = roots.flatMap((root) => {
    const rootType = root.type;
    if (!rootType) return [];
    return Object.values(rootType.getFields())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((field) => {
        const argumentsSignature = field.args
          .map((argument) => `${argument.name}:${String(argument.type)}`)
          .sort()
          .join(",");
        return {
          operationKey: `${root.kind}.${field.name}`,
          method: root.kind.toUpperCase(),
          path: `${rootType.name}.${field.name}`,
          summary: "",
          tags: [root.kind],
          capability: root.capability,
          deprecated: field.deprecationReason !== undefined,
          requestSchemaRef: argumentsSignature
            ? `graphql:args:${argumentsSignature}`
            : undefined,
          responseSchemaRef: `graphql:type:${String(field.type)}`,
          securityRequirements: [],
          locator: `#/types/${escapeJsonPointer(rootType.name)}/fields/${escapeJsonPointer(field.name)}`,
        };
      });
  });
  if (operations.length > maxOperations) {
    throw new AnalyzerError("document_too_complex", "Trop d'operations GraphQL.");
  }
  return { schemas, operations, redactedDefaultValueCount };
}

function describeType(type: GraphQLNamedType) {
  if (isObjectType(type) || isInterfaceType(type)) {
    const fields = Object.values(type.getFields())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((field) => ({
        name: field.name,
        type: String(field.type),
        arguments: field.args
          .map((argument) => ({ name: argument.name, type: String(argument.type) }))
          .sort((left, right) => left.name.localeCompare(right.name)),
        deprecated: field.deprecationReason !== undefined,
      }));
    const argumentsList = Object.values(type.getFields()).flatMap((field) => field.args);
    return {
      document: {
        kind: isObjectType(type) ? "object" : "interface",
        interfaces: type.getInterfaces().map((item) => item.name).sort(),
        fields,
      },
      fieldCount: fields.length,
      argumentCount: argumentsList.length,
      redactedDefaultValueCount: argumentsList.filter(
        (argument) => argument.defaultValue !== undefined,
      ).length,
    };
  }
  if (isInputObjectType(type)) {
    const fields = Object.values(type.getFields())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((field) => ({ name: field.name, type: String(field.type) }));
    return {
      document: { kind: "input", fields },
      fieldCount: fields.length,
      argumentCount: 0,
      redactedDefaultValueCount: Object.values(type.getFields()).filter(
        (field) => field.defaultValue !== undefined,
      ).length,
    };
  }
  if (isEnumType(type)) {
    const values = type
      .getValues()
      .map((value) => ({
        name: value.name,
        deprecated: value.deprecationReason !== undefined,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    return {
      document: { kind: "enum", values },
      fieldCount: values.length,
      argumentCount: 0,
      redactedDefaultValueCount: 0,
    };
  }
  if (isUnionType(type)) {
    return {
      document: {
        kind: "union",
        possibleTypes: type.getTypes().map((item) => item.name).sort(),
      },
      fieldCount: 0,
      argumentCount: 0,
      redactedDefaultValueCount: 0,
    };
  }
  if (isScalarType(type)) {
    return {
      document: { kind: "scalar" },
      fieldCount: 0,
      argumentCount: 0,
      redactedDefaultValueCount: 0,
    };
  }
  throw new AnalyzerError("graphql_invalid", "Type GraphQL non pris en charge.");
}

function assertBoundedJson(
  value: unknown,
  depth = 0,
  counter = { value: 0 },
) {
  counter.value += 1;
  if (depth > maxDepth || counter.value > maxNodes) {
    throw new AnalyzerError("document_too_complex", "Introspection GraphQL trop complexe.");
  }
  if (Array.isArray(value)) {
    value.forEach((child) => assertBoundedJson(child, depth + 1, counter));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((child) =>
      assertBoundedJson(child, depth + 1, counter),
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AnalyzerError("graphql_invalid", "Introspection GraphQL invalide.");
  }
  return value as Record<string, unknown>;
}

function escapeJsonPointer(value: string) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
