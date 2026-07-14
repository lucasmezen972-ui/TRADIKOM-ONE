import { z } from "zod";

export const salesAiPrioritySchema = z.enum(["low", "medium", "high"]);
export const salesAiStatusSchema = z.enum(["current", "superseded"]);

export type SalesAiPriority = z.infer<typeof salesAiPrioritySchema>;
export type SalesAiStatus = z.infer<typeof salesAiStatusSchema>;
