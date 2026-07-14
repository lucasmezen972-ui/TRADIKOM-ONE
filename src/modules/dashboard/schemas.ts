import { z } from "zod";

export const dashboardQuerySchema = z.object({
  activityLimit: z.number().int().min(1).max(20).default(8),
  workflowLimit: z.number().int().min(1).max(20).default(5),
  itemLimit: z.number().int().min(1).max(10).default(5),
  now: z.date().default(() => new Date()),
  timeZone: z
    .string()
    .min(1)
    .max(100)
    .default("America/Martinique")
    .refine(isValidTimeZone, "Fuseau horaire invalide."),
});

export type DashboardQueryInput = z.input<typeof dashboardQuerySchema>;

function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
