import { z } from "zod";

export const directoryStatusSchema = z.enum([
  "discovered",
  "under_review",
  "verified",
  "partner_only",
  "private_api",
  "deprecated",
  "blocked",
  "unavailable",
  "unknown",
]);

export const domainApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
  "paused",
]);

const optionalUrl = z.union([z.literal(""), z.string().url()]).optional();

export const softwareInputSchema = z.object({
  canonicalName: z.string().trim().min(2).max(160),
  aliases: z.array(z.string().trim().min(1).max(160)).max(25).default([]),
  vendor: z.string().trim().min(2).max(160),
  officialDomain: z.string().trim().min(3).max(253),
  country: z.string().trim().max(80).optional(),
  supportedRegions: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  languages: z.array(z.string().trim().min(2).max(20)).max(30).default([]),
  industries: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  categories: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  officialWebsite: z.string().url(),
  developerPortal: optionalUrl,
  supportPage: optionalUrl,
  partnerProgramPage: optionalUrl,
  pricingInformationPage: optionalUrl,
});

export const sourceTypeSchema = z.enum([
  "official_developer_documentation",
  "official_product_documentation",
  "official_changelog",
  "official_github_repository",
  "official_openapi_specification",
  "official_postman_collection",
  "official_graphql_schema",
  "official_oauth_metadata",
  "official_partner_page",
  "official_status_page",
  "third_party_reference",
  "community_source",
  "unknown",
]);

export const apiSourceInputSchema = z.object({
  softwareId: z.string().min(1),
  apiProductId: z.string().min(1).optional(),
  url: z.string().url(),
  sourceType: sourceTypeSchema,
});

export const apiProductInputSchema = z.object({
  softwareId: z.string().min(1),
  name: z.string().trim().min(2).max(160),
  apiStyle: z.enum(["rest", "graphql", "webhook", "other"]),
  version: z.string().trim().min(1).max(80),
  documentationUrl: z.string().url(),
});

export type SoftwareInput = z.infer<typeof softwareInputSchema>;
export type ApiSourceInput = z.infer<typeof apiSourceInputSchema>;
export type ApiProductInput = z.infer<typeof apiProductInputSchema>;
