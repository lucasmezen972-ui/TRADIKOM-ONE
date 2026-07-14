import { z } from "zod";

export const enterpriseObservabilityInputSchema = z
  .object({
    now: z.date().optional(),
  })
  .strict();

export type EnterpriseObservabilityInput = z.input<
  typeof enterpriseObservabilityInputSchema
>;

export const operationalHealthStatusSchema = z.enum([
  "healthy",
  "attention",
  "critical",
  "unavailable",
]);

export type OperationalHealthStatus = z.infer<
  typeof operationalHealthStatusSchema
>;
