import { z } from "zod";

export const aiEmployeeRoleSchema = z.enum([
  "marketing_manager",
  "sales_assistant",
  "receptionist",
  "customer_support",
  "seo_specialist",
  "content_writer",
  "business_analyst",
  "automation_engineer",
  "website_manager",
]);

export const aiEmployeeStatusSchema = z.enum(["enabled", "paused"]);

export const reviseAiEmployeeProfileSchema = z.object({
  employeeId: z.string().trim().min(1).max(160),
  displayName: z.string().trim().min(3).max(100),
  purpose: z.string().trim().min(10).max(500),
  status: aiEmployeeStatusSchema,
  workingDays: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7),
  workdayStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  workdayEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export type AiEmployeeRole = z.infer<typeof aiEmployeeRoleSchema>;
export type AiEmployeeStatus = z.infer<typeof aiEmployeeStatusSchema>;
export type ReviseAiEmployeeProfileInput = z.input<
  typeof reviseAiEmployeeProfileSchema
>;
