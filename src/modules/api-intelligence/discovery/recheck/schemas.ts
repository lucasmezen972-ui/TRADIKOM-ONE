import { z } from "zod";

export const apiSourceRecheckStatusSchema = z.enum([
  "scheduled",
  "processing",
  "succeeded",
  "retrying",
  "blocked",
  "disabled",
]);

export const apiSourceRecheckConfigurationSchema = z.object({
  sourceId: z.string().min(1),
  enabled: z.boolean(),
  intervalSeconds: z.number().int().min(900).max(2_592_000),
});

export type ApiSourceRecheckConfiguration = z.infer<
  typeof apiSourceRecheckConfigurationSchema
>;
export type ApiSourceRecheckStatus = z.infer<
  typeof apiSourceRecheckStatusSchema
>;
