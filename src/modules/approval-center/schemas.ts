import { z } from "zod";

export const approvalCenterQuerySchema = z.object({
  pendingLimit: z.number().int().min(1).max(50).default(25),
  historyLimit: z.number().int().min(1).max(50).default(15),
});

export type ApprovalCenterQueryInput = z.input<
  typeof approvalCenterQuerySchema
>;
