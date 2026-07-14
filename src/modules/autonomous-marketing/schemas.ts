import { z } from "zod";

export const marketingChannelSchema = z.enum(["email", "social", "website"]);

export const submitMarketingProposalSchema = z.object({
  proposalId: z.string().trim().min(1).max(160),
});

export const marketingProposalDecisionSchema = z.object({
  proposalId: z.string().trim().min(1).max(160),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(5).max(500),
});

export const reviseMarketingProposalSchema = z.object({
  proposalId: z.string().trim().min(1).max(160),
  title: z.string().trim().min(5).max(160),
  subject: z.string().trim().max(200).default(""),
  objective: z.string().trim().min(5).max(500),
  audience: z.string().trim().min(3).max(500),
  content: z.string().trim().min(10).max(5000),
  callToAction: z.string().trim().min(2).max(80),
  expectedOutcome: z.string().trim().min(5).max(500),
  riskSummary: z.string().trim().min(5).max(500),
  budgetCents: z.coerce.number().int().min(0).nullable().optional(),
  startsAt: z.string().trim().max(40).nullable().optional(),
  endsAt: z.string().trim().max(40).nullable().optional(),
});

export type MarketingChannel = z.infer<typeof marketingChannelSchema>;
export type MarketingProposalDecisionInput = z.input<
  typeof marketingProposalDecisionSchema
>;
export type ReviseMarketingProposalInput = z.input<
  typeof reviseMarketingProposalSchema
>;
export type SubmitMarketingProposalInput = z.input<
  typeof submitMarketingProposalSchema
>;
