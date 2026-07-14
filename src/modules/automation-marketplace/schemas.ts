import { z } from "zod";

export const createAutomationPackageSchema = z.object({
  listingId: z.string().trim().min(1).max(160),
});

export const previewAutomationPackageSchema = z.object({
  packageId: z.string().trim().min(1).max(160),
});

export type CreateAutomationPackageInput = z.input<
  typeof createAutomationPackageSchema
>;
export type PreviewAutomationPackageInput = z.input<
  typeof previewAutomationPackageSchema
>;
