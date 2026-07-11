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

export const opportunityLookupSchema = z.object({
  opportunityId: z.string().min(1),
});

export const opportunityFiltersSchema = z.object({
  search: z.string().optional(),
  stageId: z.string().optional(),
});

export const opportunityUpdateSchema = z.object({
  stageId: z.string().min(1),
  valueCents: z.number().int().min(0),
  nextFollowUpAt: z
    .string()
    .optional()
    .refine((value) => !value || !Number.isNaN(Date.parse(value))),
  lostReason: z.string().optional(),
});

export const contactMergeFieldSourceSchema = z.enum(["survivor", "merged"]);

export const contactMergeSchema = z.object({
  survivorContactId: z.string().min(1),
  mergedContactId: z.string().min(1),
  reason: z.string().min(3),
  confirm: z.boolean().refine((value) => value, {
    message: "La confirmation explicite est requise.",
  }),
  fieldSources: z
    .object({
      name: contactMergeFieldSourceSchema.optional(),
      email: contactMergeFieldSourceSchema.optional(),
      phone: contactMergeFieldSourceSchema.optional(),
      status: contactMergeFieldSourceSchema.optional(),
      source: contactMergeFieldSourceSchema.optional(),
      assignedUserId: contactMergeFieldSourceSchema.optional(),
    })
    .default({}),
});

export const duplicatePairSchema = z.object({
  leftContactId: z.string().min(1),
  rightContactId: z.string().min(1),
});

export type PublicLeadInput = z.input<typeof publicLeadSchema>;
export type LeadIngestionInput = z.input<typeof leadIngestionSchema>;
export type TenantContactLookupInput = z.input<typeof tenantContactLookupSchema>;
export type ContactUpdateInput = z.input<typeof contactUpdateSchema>;
export type ContactConsentInput = z.input<typeof contactConsentSchema>;
export type ContactNoteInput = z.input<typeof contactNoteSchema>;
export type ContactTaskInput = z.input<typeof contactTaskSchema>;
export type CompleteTaskInput = z.input<typeof completeTaskSchema>;
export type OpportunityFiltersInput = z.input<typeof opportunityFiltersSchema>;
export type OpportunityUpdateInput = z.input<typeof opportunityUpdateSchema>;
export type ContactMergeInput = z.input<typeof contactMergeSchema>;
