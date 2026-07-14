import { z } from "zod";

export const businessBrainDomainSchema = z.enum([
  "company",
  "customers",
  "suppliers",
  "catalog",
  "pricing",
  "margins",
  "objectives",
  "kpis",
  "team",
  "locations",
  "automations",
  "websites",
  "api",
  "connectors",
]);

export const businessBrainSourceSchema = z.enum([
  "manual",
  "business_twin",
  "crm",
  "workflow",
  "website",
  "connector",
  "api_intelligence",
  "import",
]);

export const businessBrainEvidenceTypeSchema = z.enum([
  "observation",
  "document",
  "system_record",
  "import",
]);

const businessBrainContentSchema = z.object({
  domain: businessBrainDomainSchema,
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().min(5).max(1000),
  details: z.string().trim().max(5000).default(""),
  confidence: z.coerce.number().int().min(0).max(100).default(80),
  sourceType: businessBrainSourceSchema.default("manual"),
  sourceRef: z.string().trim().max(500).optional(),
  evidenceType: businessBrainEvidenceTypeSchema.default("observation"),
  evidenceSummary: z.string().trim().min(5).max(500),
});

export const createBusinessBrainEntrySchema = businessBrainContentSchema;

export const reviseBusinessBrainEntrySchema = businessBrainContentSchema.extend({
  entryId: z.string().trim().min(1).max(160),
});

export const archiveBusinessBrainEntrySchema = z.object({
  entryId: z.string().trim().min(1).max(160),
});

export type BusinessBrainDomain = z.infer<typeof businessBrainDomainSchema>;
export type BusinessBrainSource = z.infer<typeof businessBrainSourceSchema>;
export type BusinessBrainEvidenceType = z.infer<
  typeof businessBrainEvidenceTypeSchema
>;
export type CreateBusinessBrainEntryInput = z.input<
  typeof createBusinessBrainEntrySchema
>;
export type ReviseBusinessBrainEntryInput = z.input<
  typeof reviseBusinessBrainEntrySchema
>;
