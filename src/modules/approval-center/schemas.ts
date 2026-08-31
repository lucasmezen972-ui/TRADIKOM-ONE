import { z } from "zod";

export const approvalCenterQuerySchema = z.object({
  pendingLimit: z.number().int().min(1).max(50).default(25),
  historyLimit: z.number().int().min(1).max(50).default(15),
});

export type ApprovalCenterQueryInput = z.input<
  typeof approvalCenterQuerySchema
>;

export const maxSnoozeDays = 90;

export const snoozeApprovalSchema = z.object({
  approvalId: z.string().min(1),
  snoozedUntil: z
    .string()
    .min(1)
    .refine((value) => !Number.isNaN(Date.parse(value)), "Date invalide."),
  reason: z.string().trim().max(300).optional(),
});

export const resumeApprovalSchema = z.object({
  approvalId: z.string().min(1),
});

export type SnoozeApprovalInput = z.input<typeof snoozeApprovalSchema>;
export type ResumeApprovalInput = z.input<typeof resumeApprovalSchema>;
