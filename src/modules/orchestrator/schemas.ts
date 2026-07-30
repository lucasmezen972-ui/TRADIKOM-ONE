import { z } from "zod";

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const businessTextSchema = z.string().trim().min(1).max(2_000);
const capabilityNameSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
const forbiddenInputKey =
  /(authorization|credential|password|secret|token|api[_-]?key)/i;

export const capabilityRiskSchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export const actionPlanStepSchema = z
  .object({
    stepId: identifierSchema,
    capability: capabilityNameSchema,
    providerPreference: z.array(identifierSchema).max(5).default([]),
    input: z
      .record(z.string().trim().min(1).max(120), z.unknown())
      .superRefine((input, context) => {
        const keys = Object.keys(input);
        if (keys.length > 32) {
          context.addIssue({
            code: "custom",
            message: "Une étape ne peut pas contenir plus de 32 entrées.",
          });
        }
        const sensitivePath = findSensitiveInputPath(input);
        if (sensitivePath) {
          context.addIssue({
            code: "custom",
            message: "Les secrets et credentials sont interdits dans un plan.",
            path: sensitivePath,
          });
        }
        const serialized = safelySerializeInput(input);
        if (serialized === null || serialized.length > 16_000) {
          context.addIssue({
            code: "custom",
            message:
              "Les entrées de l'étape doivent être sérialisables et bornées.",
          });
        }
      }),
    risk: capabilityRiskSchema,
    requiresApproval: z.boolean(),
    reversible: z.union([z.boolean(), z.literal("compensation_only")]),
    evidenceRequired: z.array(businessTextSchema).min(1).max(8),
    idempotencyKey: identifierSchema,
  })
  .strict();

export const actionPlanSchema = z
  .object({
    intent: businessTextSchema,
    businessGoal: businessTextSchema,
    confidence: z.number().min(0).max(1),
    missingContextQuestions: z.array(businessTextSchema).max(3),
    riskSummary: businessTextSchema,
    estimatedCost: z
      .object({
        amount: z.number().nonnegative().max(1_000_000),
        currency: z.string().trim().length(3).toUpperCase(),
      })
      .strict()
      .optional(),
    steps: z
      .array(actionPlanStepSchema)
      .min(1)
      .max(12)
      .superRefine((steps, context) => {
        const stepIds = new Set<string>();
        const idempotencyKeys = new Set<string>();
        for (const [index, step] of steps.entries()) {
          if (stepIds.has(step.stepId)) {
            context.addIssue({
              code: "custom",
              message: "Chaque étape doit avoir un identifiant unique.",
              path: [index, "stepId"],
            });
          }
          if (idempotencyKeys.has(step.idempotencyKey)) {
            context.addIssue({
              code: "custom",
              message: "Chaque étape doit avoir une clé d'idempotence unique.",
              path: [index, "idempotencyKey"],
            });
          }
          stepIds.add(step.stepId);
          idempotencyKeys.add(step.idempotencyKey);
        }
      }),
    finalUserMessageDraft: businessTextSchema,
  })
  .strict();

export const actionPlanProposalSchema = z
  .object({
    id: identifierSchema,
    tenantId: identifierSchema,
    threadId: identifierSchema,
    sourceMessageId: identifierSchema,
    schemaVersion: z.literal(1),
    generationSource: z.enum(["deterministic_mock", "model"]),
    modelReference: z.string().trim().min(1).max(160).optional(),
    approvalStatus: z.enum([
      "draft",
      "awaiting_approval",
      "approved",
      "rejected",
      "executed",
    ]),
    createdAt: z.string().datetime({ offset: true }),
    plan: actionPlanSchema,
  })
  .strict()
  .superRefine((proposal, context) => {
    if (proposal.generationSource === "model" && !proposal.modelReference) {
      context.addIssue({
        code: "custom",
        message: "Une génération modèle doit conserver sa référence.",
        path: ["modelReference"],
      });
    }
    if (
      ["approved", "executed"].includes(proposal.approvalStatus) &&
      proposal.plan.missingContextQuestions.length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Un plan incomplet ne peut pas être approuvé.",
        path: ["approvalStatus"],
      });
    }
    if (
      proposal.generationSource === "deterministic_mock" &&
      proposal.modelReference
    ) {
      context.addIssue({
        code: "custom",
        message: "Un plan déterministe ne doit pas revendiquer de modèle.",
        path: ["modelReference"],
      });
    }
  });

export const actionPlanCreationSchema = z
  .object({
    tenantId: identifierSchema,
    threadId: identifierSchema,
    sourceMessageId: identifierSchema,
  })
  .strict();

export const actionPlanDecisionSchema = z
  .object({
    planId: identifierSchema,
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export type CapabilityRisk = z.infer<typeof capabilityRiskSchema>;
export type ActionPlanStep = z.infer<typeof actionPlanStepSchema>;
export type ActionPlan = z.infer<typeof actionPlanSchema>;
export type ActionPlanProposal = z.infer<typeof actionPlanProposalSchema>;
export type ActionPlanCreation = z.infer<typeof actionPlanCreationSchema>;
export type ActionPlanDecision = z.infer<typeof actionPlanDecisionSchema>;

function safelySerializeInput(input: Record<string, unknown>) {
  try {
    return JSON.stringify(input) ?? null;
  } catch {
    return null;
  }
}

function findSensitiveInputPath(
  value: unknown,
  path: Array<string | number> = [],
  visited = new WeakSet<object>(),
): Array<string | number> | null {
  if (!value || typeof value !== "object") return null;
  if (visited.has(value)) return null;
  visited.add(value);

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (forbiddenInputKey.test(key)) return nextPath;
    const nestedSensitivePath = findSensitiveInputPath(
      nestedValue,
      nextPath,
      visited,
    );
    if (nestedSensitivePath) return nestedSensitivePath;
  }
  return null;
}
