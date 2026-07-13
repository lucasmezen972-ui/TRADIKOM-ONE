import { z } from "zod";

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
  operations: z.array(
    z.object({
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
    }),
  ),
  schemas: z.array(
    z.object({ name: z.string().min(1), document: z.unknown() }),
  ),
  blockedExternalReferences: z.literal(0),
});

export type OpenApiPreview = z.infer<typeof openApiPreviewSchema>;
