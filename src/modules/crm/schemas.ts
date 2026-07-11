import { z } from "zod";

export const publicLeadSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  message: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

export const leadIngestionSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  message: z.string().optional(),
  source: z.string().min(1),
  pagePath: z.string().min(1),
  websiteId: z.string().optional(),
});

export const tenantContactLookupSchema = z.object({
  contactId: z.string().min(1),
});

export type PublicLeadInput = z.input<typeof publicLeadSchema>;
export type LeadIngestionInput = z.input<typeof leadIngestionSchema>;
export type TenantContactLookupInput = z.input<typeof tenantContactLookupSchema>;
