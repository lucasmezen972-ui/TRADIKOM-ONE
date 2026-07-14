import { z } from "zod";

export const competitorCategorySchema = z.enum([
  "price",
  "website",
  "seo",
  "service",
  "product",
  "google_position",
  "advertising",
  "social_activity",
  "review",
  "opening_hours",
  "job",
  "partnership",
]);

export const competitorDirectionSchema = z.enum([
  "increase",
  "decrease",
  "new",
  "removed",
  "changed",
  "positive_signal",
  "negative_signal",
]);

export const competitorSourceTypeSchema = z.enum([
  "official_website",
  "public_search",
  "public_social",
  "public_directory",
  "public_ad",
  "public_job",
  "public_review",
  "public_announcement",
]);

const publicHttpsUrlSchema = z.string().trim().min(10).max(500).superRefine(
  (value, context) => {
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase();
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname === "0.0.0.0" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        !hostname.includes(".")
      ) {
        context.addIssue({
          code: "custom",
          message: "Une URL HTTPS publique est requise.",
        });
      }
      for (const key of url.searchParams.keys()) {
        if (/token|secret|password|auth|api.?key|signature/i.test(key)) {
          context.addIssue({
            code: "custom",
            message: "L'URL ne doit contenir aucun paramètre sensible.",
          });
        }
      }
    } catch {
      context.addIssue({ code: "custom", message: "L'URL publique est invalide." });
    }
  },
);

export const competitorProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  websiteUrl: publicHttpsUrlSchema.optional(),
});

export const competitorObservationSchema = z.object({
  competitorId: z.string().trim().min(1).max(160),
  category: competitorCategorySchema,
  direction: competitorDirectionSchema,
  sourceType: competitorSourceTypeSchema,
  sourceUrl: publicHttpsUrlSchema,
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().min(10).max(2000),
  observedValue: z.string().trim().max(300).optional(),
  observedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  publicSourceConfirmed: z.boolean().refine((value) => value, {
    message: "La source publique doit être confirmée.",
  }),
  protectedContentExcluded: z.boolean().refine((value) => value, {
    message: "Le contenu protégé doit être exclu.",
  }),
});

export const competitorInsightReferenceSchema = z.object({
  insightId: z.string().trim().min(1).max(160),
});

export const competitorInsightDecisionSchema = z.object({
  insightId: z.string().trim().min(1).max(160),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(5).max(500),
});

export type CompetitorCategory = z.infer<typeof competitorCategorySchema>;
export type CompetitorDirection = z.infer<typeof competitorDirectionSchema>;
export type CompetitorSourceType = z.infer<typeof competitorSourceTypeSchema>;
export type CompetitorProfileInput = z.input<typeof competitorProfileSchema>;
export type CompetitorObservationInput = z.input<typeof competitorObservationSchema>;
export type CompetitorInsightReferenceInput = z.input<typeof competitorInsightReferenceSchema>;
export type CompetitorInsightDecisionInput = z.input<typeof competitorInsightDecisionSchema>;
