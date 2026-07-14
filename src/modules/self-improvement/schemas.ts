import { z } from "zod";

export const selfImprovementDecisionSchema = z.object({
  proposalId: z.string().trim().min(1).max(200),
  decision: z.enum(["accepted", "dismissed"]),
  reason: z.string().trim().min(10).max(800),
});

export type SelfImprovementDecisionInput = z.input<
  typeof selfImprovementDecisionSchema
>;
