import { z } from "zod";

export const importFormatSchema = z.enum(["csv", "xlsx", "json"]);
export const importEntitySchema = z.enum([
  "contacts",
  "companies",
  "products",
  "opportunities",
]);

export const importMappingSchema = z.record(
  z.string().trim().min(1).max(64),
  z.string().trim().min(1).max(128),
);

export const importPreviewSchema = z.object({
  entityType: importEntitySchema,
  format: importFormatSchema,
  fileName: z.string().trim().min(1).max(180),
  contentType: z.string().trim().min(1).max(120),
  mapping: importMappingSchema,
  sheetName: z.string().trim().min(1).max(120).optional(),
});

export const importJobReferenceSchema = z.object({
  importId: z.string().trim().min(1).max(96),
});

export const importCommitSchema = importJobReferenceSchema.extend({
  batchSize: z.coerce.number().int().min(1).max(500).default(200),
});

export type ImportEntity = z.infer<typeof importEntitySchema>;
export type ImportFormat = z.infer<typeof importFormatSchema>;
export type ImportMapping = z.infer<typeof importMappingSchema>;
export type ImportPreviewInput = z.input<typeof importPreviewSchema>;

export const importTargetFields: Record<ImportEntity, readonly string[]> = {
  contacts: ["name", "email", "phone", "status", "tags"],
  companies: ["name", "domain"],
  products: ["name", "sku", "price"],
  opportunities: ["contact_email", "stage_name", "value"],
};
export const requiredImportTargetFields: Record<
  ImportEntity,
  readonly string[]
> = {
  contacts: ["name", "email"],
  companies: ["name"],
  products: ["name", "sku"],
  opportunities: ["contact_email", "stage_name", "value"],
};
