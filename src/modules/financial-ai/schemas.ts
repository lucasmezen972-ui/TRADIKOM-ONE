import { z } from "zod";

const moneySchema = z.coerce.number().int().min(0).max(100_000_000_000);
const countSchema = z.coerce.number().int().min(0).max(10_000_000);

export const financialPeriodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "La période doit utiliser le format AAAA-MM.");

export const financialInputSnapshotSchema = z.object({
  period: financialPeriodSchema,
  monthlyRevenueCents: moneySchema,
  operatingCostsCents: moneySchema,
  cashBalanceCents: moneySchema,
  cashInflowsCents: moneySchema,
  cashOutflowsCents: moneySchema,
  receivablesCents: moneySchema,
  payablesCents: moneySchema,
  marketingSpendCents: moneySchema,
  salesSpendCents: moneySchema,
  websiteSpendCents: moneySchema,
  automationSpendCents: moneySchema,
  newCustomers: countSchema,
  activeCustomers: countSchema,
  averageLifetimeMonths: countSchema.max(600).nullable().default(null),
  marketingAttributedRevenueCents: moneySchema.nullable().default(null),
  salesAttributedRevenueCents: moneySchema.nullable().default(null),
  websiteAttributedRevenueCents: moneySchema.nullable().default(null),
  automationSavingsCents: moneySchema.nullable().default(null),
  evidenceSummary: z.string().trim().min(10).max(500),
});

export const financialAlertSeveritySchema = z.enum([
  "info",
  "warning",
  "critical",
]);

export type FinancialInputSnapshotInput = z.input<
  typeof financialInputSnapshotSchema
>;
export type FinancialAlertSeverity = z.infer<
  typeof financialAlertSeveritySchema
>;
