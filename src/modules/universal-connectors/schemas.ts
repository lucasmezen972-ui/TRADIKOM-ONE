import { z } from "zod";

export const connectorIndustryMatchSchema = z.enum([
  "aligned",
  "not_documented",
]);

export const connectorInstallationPlanStatusSchema = z.enum([
  "current",
  "superseded",
]);

export const prepareConnectorInstallationPlanSchema = z.object({
  storeEntryId: z.string().trim().min(1).max(160),
});

export type PrepareConnectorInstallationPlanInput = z.input<
  typeof prepareConnectorInstallationPlanSchema
>;
