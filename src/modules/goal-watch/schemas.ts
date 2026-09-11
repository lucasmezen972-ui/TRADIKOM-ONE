import { z } from "zod";

const boundedIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const timestampSchema = z.string().datetime({ offset: true });

export const goalWatchSignalSchema = z.enum([
  "contacts",
  "opportunities",
  "pipeline_value_cents",
  "members",
  "active_workflows",
  "websites",
  "published_websites",
  "connectors",
  "api_assets",
]);

export const goalWatchOperatorSchema = z.enum(["gte", "lte"]);
export const goalWatchStateSchema = z.enum(["pending", "met"]);

export const goalWatchConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    threadId: boundedIdentifierSchema,
    signal: goalWatchSignalSchema,
    operator: goalWatchOperatorSchema,
    target: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    cadenceMinutes: z.number().int().min(60).max(10_080),
  })
  .strict();

export const createGoalWatchInputSchema = z
  .object({
    threadId: boundedIdentifierSchema,
    title: z.string().trim().min(3).max(120),
    signal: goalWatchSignalSchema,
    operator: goalWatchOperatorSchema,
    target: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    cadenceMinutes: z.number().int().min(60).max(10_080).default(1_440),
  })
  .strict();

export const evaluateGoalWatchInputSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    goalId: boundedIdentifierSchema,
    evaluationKey: z
      .string()
      .trim()
      .min(8)
      .max(160)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    observedAt: timestampSchema,
  })
  .strict();

export const goalWatchEvaluationAuditSchema = z
  .object({
    schemaVersion: z.literal(1),
    signal: goalWatchSignalSchema,
    state: goalWatchStateSchema,
    evaluationKey: z.string().min(8).max(160),
    observedAt: timestampSchema,
    reported: z.boolean(),
    reportMessageId: boundedIdentifierSchema.nullable(),
  })
  .strict();

export type GoalWatchSignal = z.infer<typeof goalWatchSignalSchema>;
export type GoalWatchOperator = z.infer<typeof goalWatchOperatorSchema>;
export type GoalWatchState = z.infer<typeof goalWatchStateSchema>;
export type GoalWatchConfig = z.infer<typeof goalWatchConfigSchema>;
export type CreateGoalWatchInput = z.input<typeof createGoalWatchInputSchema>;
export type EvaluateGoalWatchInput = z.infer<typeof evaluateGoalWatchInputSchema>;
export type GoalWatchEvaluationAudit = z.infer<
  typeof goalWatchEvaluationAuditSchema
>;
