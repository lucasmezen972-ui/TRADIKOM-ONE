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

/**
 * Seul le contenu destiné à être publié est modifiable. La justification, le
 * gain attendu et les risques restent ceux de l'analyse ; et l'empreinte du
 * contenu d'origine est reprise telle quelle, sinon réviser remettrait à zéro
 * la garde qui empêche d'appliquer une proposition à une section modifiée
 * entre-temps.
 */
export const reviseWebsiteAiProposalSchema = z.object({
  proposalId: z.string().trim().min(1).max(160),
  proposedTitle: z.string().trim().min(1).max(300),
  proposedBody: z.string().trim().min(1).max(5000),
});

export type ReviseWebsiteAiProposalInput = z.input<
  typeof reviseWebsiteAiProposalSchema
>;
