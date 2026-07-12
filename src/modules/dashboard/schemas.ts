import { z } from "zod";

export const dashboardQuerySchema = z.object({
  activityLimit: z.number().int().min(1).max(20).default(8),
  workflowLimit: z.number().int().min(1).max(20).default(5),
});

export type DashboardQueryInput = z.input<typeof dashboardQuerySchema>;
