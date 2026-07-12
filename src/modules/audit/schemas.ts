import { z } from "zod";

export const auditLogQuerySchema = z.object({
  limit: z.number().int().min(1).max(100).default(40),
});

export type AuditLogQueryInput = z.input<typeof auditLogQuerySchema>;
