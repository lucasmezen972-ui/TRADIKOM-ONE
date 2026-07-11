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

export const contactUpdateSchema = z.object({
  name: z.string().min(1),
  phone: z.string().default(""),
  status: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  assignedUserId: z.string().min(1).nullable().optional(),
});

export const contactConsentSchema = z.object({
  marketingOptIn: z.boolean(),
  privacyNoticeAccepted: z.boolean(),
  dataRetentionUntil: z.string().optional(),
});

export const contactNoteSchema = z.object({
  body: z.string().min(1),
});

export const contactTaskSchema = z.object({
  title: z.string().min(1),
  dueAt: z.string().min(1).refine((value) => !Number.isNaN(Date.parse(value))),
  assignedUserId: z.string().min(1).optional(),
});

export const completeTaskSchema = z.object({
  taskId: z.string().min(1),
});

export type PublicLeadInput = z.input<typeof publicLeadSchema>;
export type LeadIngestionInput = z.input<typeof leadIngestionSchema>;
export type TenantContactLookupInput = z.input<typeof tenantContactLookupSchema>;
export type ContactUpdateInput = z.input<typeof contactUpdateSchema>;
export type ContactConsentInput = z.input<typeof contactConsentSchema>;
export type ContactNoteInput = z.input<typeof contactNoteSchema>;
export type ContactTaskInput = z.input<typeof contactTaskSchema>;
export type CompleteTaskInput = z.input<typeof completeTaskSchema>;
