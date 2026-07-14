import { z } from "zod";

export const domainProviderKeySchema = z.enum(["mock_dns", "manual"]);

export const domainConnectionStateSchema = z.enum([
  "discovered",
  "analysis_pending",
  "analyzed",
  "manual_setup_required",
  "provider_connection_available",
  "change_plan_ready",
  "awaiting_approval",
  "applying",
  "propagation_pending",
  "verified",
  "failed",
  "rollback_required",
  "disconnected",
]);

export const dnsRecordTypeSchema = z.enum([
  "A",
  "AAAA",
  "CNAME",
  "MX",
  "TXT",
  "NS",
]);

export const dnsRecordSchema = z.object({
  type: dnsRecordTypeSchema,
  name: z.string().trim().min(1).max(253),
  value: z.string().trim().min(1).max(2048),
  ttl: z.number().int().min(60).max(86400),
  priority: z.number().int().min(0).max(65535).nullable().default(null),
});

export const domainEvidenceSchema = z.object({
  field: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(2048),
  confidence: z.number().int().min(0).max(100),
  source: z.string().trim().min(1).max(120),
  observedAt: z.string().datetime(),
  status: z.enum(["verified", "inferred"]),
});

export const dnsChangeSchema = z.object({
  action: z.enum(["create", "update", "delete"]),
  record: dnsRecordSchema,
  previousRecord: dnsRecordSchema.nullable().default(null),
  reason: z.string().trim().min(1).max(500),
});

export const analyzeDomainConnectionSchema = z.object({
  domain: z.string().trim().min(1).max(253),
  providerKey: domainProviderKeySchema.default("mock_dns"),
});

export const prepareDnsChangePlanSchema = z.object({
  connectionId: z.string().trim().min(1).max(160),
  changes: z.array(dnsChangeSchema).min(1).max(20).optional(),
});

export const dnsPlanReferenceSchema = z.object({
  planId: z.string().trim().min(1).max(160),
});

export type DomainProviderKey = z.infer<typeof domainProviderKeySchema>;
export type DomainConnectionState = z.infer<
  typeof domainConnectionStateSchema
>;
export type DnsRecord = z.infer<typeof dnsRecordSchema>;
export type DomainEvidence = z.infer<typeof domainEvidenceSchema>;
export type DnsChange = z.infer<typeof dnsChangeSchema>;
export type AnalyzeDomainConnectionInput = z.input<
  typeof analyzeDomainConnectionSchema
>;
export type PrepareDnsChangePlanInput = z.input<
  typeof prepareDnsChangePlanSchema
>;
