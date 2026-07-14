import { z } from "zod";

export const marketplaceCategorySchema = z.enum([
  "connector",
  "workflow",
  "ai_employee",
]);

export const marketplaceSourceKindSchema = z.enum([
  "connector_plan",
  "workflow",
  "ai_employee_profile",
]);

export const previewMarketplaceInstallationSchema = z.object({
  listingId: z.string().trim().min(1).max(160),
});

export type MarketplaceCategory = z.infer<typeof marketplaceCategorySchema>;
export type MarketplaceSourceKind = z.infer<typeof marketplaceSourceKindSchema>;
export type PreviewMarketplaceInstallationInput = z.input<
  typeof previewMarketplaceInstallationSchema
>;
