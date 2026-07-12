import { z } from "zod";

export const csvImportSchema = z.object({
  csvText: z.string(),
});

export const webhookTokenSchema = z.object({
  token: z.string().min(1),
});

export const webhookPayloadSchema = z.record(z.string(), z.unknown());

export const webhookIdempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9_.:-]+$/);

export const webhookSecretRotationSchema = z.object({
  endpointId: z.string().min(1),
  secret: z.string().min(16).max(256),
});

export const webhookEndpointStatusSchema = z.object({
  endpointId: z.string().min(1),
  status: z.enum(["active", "disabled"]),
});

export type CsvImportInput = z.input<typeof csvImportSchema>;
export type WebhookSecretRotationInput = z.input<
  typeof webhookSecretRotationSchema
>;
export type WebhookEndpointStatusInput = z.input<
  typeof webhookEndpointStatusSchema
>;
