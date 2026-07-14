import { z } from "zod";

export const apiOperationPreviewSchema = z.object({
  operationKey: z.string().min(1),
  method: z.string().min(1),
  path: z.string().min(1),
  summary: z.string(),
  tags: z.array(z.string()),
  capability: z.enum(["read", "write"]),
  deprecated: z.boolean(),
  requestSchemaRef: z.string().optional(),
  responseSchemaRef: z.string().optional(),
  securityRequirements: z.array(z.record(z.string(), z.array(z.string()))),
  locator: z.string().min(1).optional(),
  exampleCount: z.number().int().min(0).max(500).optional(),
});

const apiContractPreviewFields = {
  snapshotId: z.string().min(1),
  apiProductId: z.string().min(1),
  sourceHash: z.string().length(64),
  title: z.string().min(1),
  version: z.string().min(1),
  baseUrl: z.string().optional(),
  authenticationType: z.string(),
  oauthMetadata: z.record(z.string(), z.unknown()),
  scopes: z.array(z.string()),
  webhookSupport: z.boolean(),
  rateLimitFingerprint: z.string().length(64).optional(),
  rateLimitLocators: z.array(z.string()).max(100),
  operations: z.array(apiOperationPreviewSchema).max(500),
  schemas: z
    .array(
      z.object({
        name: z.string().min(1),
        document: z.unknown(),
        locator: z.string().min(1).optional(),
      }),
    )
    .max(500),
};

export const openApiDocumentSchema = z
  .object({
    openapi: z.string().regex(/^3\.(0|1)(?:\.\d+)?$/),
    info: z.object({
      title: z.string().min(1),
      version: z.string().min(1),
    }),
    servers: z.array(z.object({ url: z.string() }).passthrough()).optional(),
    paths: z.record(z.string(), z.record(z.string(), z.unknown())),
    components: z
      .object({
        schemas: z.record(z.string(), z.unknown()).optional(),
        securitySchemes: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
    webhooks: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const openApiPreviewSchema = z.object({
  parserVersion: z.literal("openapi-1"),
  ...apiContractPreviewFields,
  blockedExternalReferences: z.literal(0),
});

export const postmanCollectionDocumentSchema = z
  .object({
    info: z
      .object({
        name: z.string().trim().min(1).max(240),
        schema: z.string().url(),
        version: z.unknown().optional(),
      })
      .passthrough(),
    item: z.array(z.unknown()),
    auth: z.unknown().optional(),
    event: z.array(z.unknown()).optional(),
    variable: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const postmanPreviewSchema = z.object({
  parserVersion: z.literal("postman-1"),
  ...apiContractPreviewFields,
  collectionSchema: z.literal("v2.1.0"),
  variables: z
    .array(
      z.object({
        key: z.string().min(1),
        type: z.string(),
        disabled: z.boolean(),
        scope: z.enum(["collection", "folder", "request", "url"]),
        locator: z.string().min(1),
      }),
    )
    .max(200),
  examples: z
    .array(
      z.object({
        operationKey: z.string().min(1),
        name: z.string(),
        status: z.string(),
        code: z.number().int().min(0).max(999).optional(),
        bodyPresent: z.boolean(),
        locator: z.string().min(1),
      }),
    )
    .max(500),
  scripts: z
    .array(
      z.object({
        event: z.string(),
        disabled: z.boolean(),
        scope: z.enum(["collection", "folder", "request"]),
        locator: z.string().min(1),
      }),
    )
    .max(200),
  blockedScriptCount: z.number().int().min(0).max(200),
});

export const graphQlPreviewSchema = z.object({
  parserVersion: z.literal("graphql-1"),
  ...apiContractPreviewFields,
  sourceFormat: z.enum(["sdl", "introspection"]),
  redactedDefaultValueCount: z.number().int().min(0).max(10_000),
});

export const oauthMetadataPreviewSchema = z.object({
  parserVersion: z.literal("oauth-metadata-1"),
  ...apiContractPreviewFields,
  issuer: z.string().url(),
  authorizationEndpoint: z.string().url().optional(),
  tokenEndpoint: z.string().url().optional(),
  revocationEndpoint: z.string().url().optional(),
  grantTypes: z.array(z.string().min(1)).max(100),
  responseTypes: z.array(z.string().min(1)).max(100),
  tokenEndpointAuthMethods: z.array(z.string().min(1)).max(100),
  codeChallengeMethods: z.array(z.string().min(1)).max(100),
  pkceSupported: z.boolean(),
  pkceS256Supported: z.boolean(),
  signedMetadataPresent: z.boolean(),
});

export type OpenApiPreview = z.infer<typeof openApiPreviewSchema>;
export type PostmanPreview = z.infer<typeof postmanPreviewSchema>;
export type GraphQlPreview = z.infer<typeof graphQlPreviewSchema>;
export type OauthMetadataPreview = z.infer<typeof oauthMetadataPreviewSchema>;
export type ApiContractPreview =
  | OpenApiPreview
  | PostmanPreview
  | GraphQlPreview
  | OauthMetadataPreview;
