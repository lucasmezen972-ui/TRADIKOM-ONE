import { z } from "zod";

export const apiChangeClassificationSchema = z.enum([
  "informational",
  "additive",
  "potentially_breaking",
  "breaking",
  "security_relevant",
  "access_policy_change",
]);

export const apiChangeKindSchema = z.enum([
  "source_content_changed",
  "etag_changed",
  "last_modified_changed",
  "access_policy_changed",
  "specification_unreadable",
  "specification_readable",
  "endpoint_added",
  "endpoint_removed",
  "endpoint_signature_changed",
  "operation_schema_changed",
  "operation_security_changed",
  "schema_added",
  "schema_removed",
  "schema_changed",
  "authentication_changed",
  "scopes_changed",
  "webhook_support_changed",
  "api_version_changed",
  "base_url_changed",
  "rate_limit_changed",
  "deprecation_changed",
]);

export const apiChangeItemSchema = z.object({
  kind: apiChangeKindSchema,
  classification: apiChangeClassificationSchema,
  target: z.string().min(1).optional(),
  details: z
    .record(
      z.string(),
      z.union([z.string(), z.boolean(), z.array(z.string())]),
    )
    .optional(),
});

export const apiChangeSummarySchema = z.object({
  monitorVersion: z.literal("api-change-1"),
  previousApiVersion: z.string().optional(),
  currentApiVersion: z.string().optional(),
  changes: z.array(apiChangeItemSchema),
});

export const apiChangeDecisionSchema = z.object({
  impactId: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(3).max(500),
});

export type ApiChangeClassification = z.infer<
  typeof apiChangeClassificationSchema
>;
export type ApiChangeItem = z.infer<typeof apiChangeItemSchema>;
export type ApiChangeSummary = z.infer<typeof apiChangeSummarySchema>;
