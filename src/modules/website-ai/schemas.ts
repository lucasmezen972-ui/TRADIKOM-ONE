import { z } from "zod";

export const websiteAiProposalDecisionSchema = z.object({
  proposalId: z.string().trim().min(1).max(160),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(5).max(500),
});

export const websiteAiProposalReferenceSchema = z.object({
  proposalId: z.string().trim().min(1).max(160),
});

export type WebsiteAiProposalDecisionInput = z.input<
  typeof websiteAiProposalDecisionSchema
>;
export type WebsiteAiProposalReferenceInput = z.input<
  typeof websiteAiProposalReferenceSchema
>;
