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

export const strategicRuleMuteSchema = z.object({
  ruleKey: z.string().trim().min(3).max(160),
});

export type StrategicAdvisorRole = z.infer<typeof strategicAdvisorRoleSchema>;
export type StrategicRuleMuteInput = z.input<typeof strategicRuleMuteSchema>;
export type StrategicEffort = z.infer<typeof strategicEffortSchema>;
export type StrategicRecommendationDecisionInput = z.input<
  typeof strategicRecommendationDecisionSchema
>;
