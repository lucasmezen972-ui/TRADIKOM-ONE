import { z } from "zod";

export const suppressionReasons = ["permanent_failure", "manual"] as const;

export const releaseSuppressionSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
});

export const suppressEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  reason: z.enum(suppressionReasons),
  provider: z.string().trim().min(1).max(64),
  errorCode: z.string().trim().max(64).nullish(),
  detail: z.string().trim().min(1).max(500),
});

export type SuppressionReason = (typeof suppressionReasons)[number];
export type ReleaseSuppressionInput = z.input<typeof releaseSuppressionSchema>;
export type SuppressEmailInput = z.input<typeof suppressEmailSchema>;
