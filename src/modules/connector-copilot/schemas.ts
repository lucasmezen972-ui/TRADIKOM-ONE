import { z } from "zod";
import { canonicalEntitySchema } from "@/modules/api-intelligence/ontology";

export const connectorManifestSchema = z.object({
  manifestVersion: z.literal("1"),
  connectorKey: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(2).max(160),
  version: z.string().min(1).max(40),
  enabled: z.literal(false),
  apiProductId: z.string().min(1),
  authentication: z.object({ type: z.string().min(1) }),
  capabilities: z.array(
    z.object({
      operationKey: z.string().min(1),
      method: z.string().min(1),
      path: z.string().min(1),
      direction: z.enum(["read", "write"]),
      timeoutMs: z.number().int().min(100).max(30_000),
      idempotencyRequired: z.boolean(),
    }),
  ),
  mappings: z.array(
    z.object({
      sourceEntity: z.string().min(1),
      canonicalEntity: canonicalEntitySchema,
    }),
  ),
  pagination: z.object({ strategy: z.enum(["none", "cursor", "page"]) }),
  retry: z.object({ maxAttempts: z.number().int().min(1).max(5), backoff: z.literal("exponential") }),
  rateLimit: z.object({ strategy: z.literal("respect_headers") }),
  webhooks: z.object({ supported: z.boolean() }),
  fixtureVersion: z.literal("1"),
});

export const connectorProposalInputSchema = z.object({
  compatibilityCheckId: z.string().min(1),
  name: z.string().trim().min(2).max(160),
});

export type ConnectorManifest = z.infer<typeof connectorManifestSchema>;
