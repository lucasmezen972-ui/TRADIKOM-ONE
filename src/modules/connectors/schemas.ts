import { z } from "zod";

export const csvImportSchema = z.object({
  csvText: z.string(),
});

export const webhookTokenSchema = z.object({
  token: z.string().min(1),
});

export const webhookPayloadSchema = z.record(z.string(), z.unknown());

export type CsvImportInput = z.input<typeof csvImportSchema>;
