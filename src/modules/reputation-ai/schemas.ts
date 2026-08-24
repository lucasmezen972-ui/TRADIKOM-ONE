import { z } from "zod";

export const reputationSourceSchema = z.enum([
  "google",
  "facebook",
  "instagram",
  "tripadvisor",
  "trustpilot",
  "industry_directory",
  "direct_feedback",
  "manual_import",
]);

export const reputationReviewSchema = z.object({
  source: reputationSourceSchema,
  externalRef: z.string().trim().max(200).optional(),
  reviewerAlias: z.string().trim().max(100).optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  reviewText: z.string().trim().min(3).max(3000),
  occurredAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
});

export const reputationProposalReferenceSchema = z.object({
  proposalId: z.string().trim().min(1).max(160),
});

export const reputationProposalDecisionSchema = z.object({
  proposalId: z.string().trim().min(1).max(160),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(5).max(500),
});

export type ReputationSource = z.infer<typeof reputationSourceSchema>;
export type ReputationReviewInput = z.input<typeof reputationReviewSchema>;
export type ReputationProposalReferenceInput = z.input<
  typeof reputationProposalReferenceSchema
>;
export type ReputationProposalDecisionInput = z.input<
  typeof reputationProposalDecisionSchema
>;

/**
 * Seul le contenu adressé au client est modifiable. Le sentiment, la
 * confiance et le niveau de risque sont des évaluations, pas de la rédaction ;
 * et réécrire la justification ferait mentir la piste d'audit sur ce que le
 * modèle a réellement avancé.
 */
export const reviseReputationProposalSchema = z.object({
  proposalId: z.string().trim().min(1).max(160),
  responseDraft: z.string().trim().min(10).max(1500),
  improvementPlan: z.string().trim().min(10).max(1500),
});

export type ReviseReputationProposalInput = z.input<
  typeof reviseReputationProposalSchema
>;
