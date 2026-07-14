import { z } from "zod";

export const strategicAdvisorRoleSchema = z.enum([
  "executive",
  "marketing",
  "sales",
  "operations",
  "finance",
  "reputation",
  "technology",
]);

export const strategicEffortSchema = z.enum(["low", "medium", "high"]);

export const strategicRecommendationDecisionSchema = z.object({
  recommendationId: z.string().trim().min(1).max(160),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(5).max(500),
});

export type StrategicAdvisorRole = z.infer<typeof strategicAdvisorRoleSchema>;
export type StrategicEffort = z.infer<typeof strategicEffortSchema>;
export type StrategicRecommendationDecisionInput = z.input<
  typeof strategicRecommendationDecisionSchema
>;
