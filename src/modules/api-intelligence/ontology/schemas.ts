import { z } from "zod";

export const canonicalEntities = [
  "Contact",
  "Company",
  "Lead",
  "Opportunity",
  "Appointment",
  "Reservation",
  "Quote",
  "Order",
  "Invoice",
  "Payment",
  "Product",
  "Service",
  "Vehicle",
  "Property",
  "WorkOrder",
  "Review",
  "Message",
  "Employee",
  "Location",
  "Availability",
  "Campaign",
  "Consent",
  "Task",
  "Activity",
] as const;

export const canonicalEntitySchema = z.enum(canonicalEntities);

export const ontologyMappingInputSchema = z.object({
  apiProductId: z.string().min(1),
  sourceEntity: z.string().trim().min(1).max(160),
  canonicalEntity: canonicalEntitySchema,
  sourceField: z.string().trim().min(1).max(160).optional(),
  canonicalField: z.string().trim().min(1).max(160).optional(),
  confidence: z.number().int().min(0).max(100),
  evidenceId: z.string().min(1),
});

export const globalMappingPromotionSchema = z.object({
  mappingId: z.string().min(1).max(160),
  reason: z.string().trim().min(3).max(500),
});

export const globalMappingReuseSchema = z.object({
  globalMappingId: z.string().min(1).max(160),
});

export type OntologyMappingInput = z.infer<typeof ontologyMappingInputSchema>;
