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
const forbiddenJsonObjectKey = /^__proto__$/u;
const maximumActionPlanInputDepth = 32;
const maximumActionPlanDepth = maximumActionPlanInputDepth + 3;
const maximumGeneratedActionPlanDepth = maximumActionPlanDepth + 1;
const maximumActionPlanJsonProperties = 200_000;
const maximumActionPlanInputCharacters = 16_000;
const maximumActionPlanJsonCharacters = 512_000;
const actionPlanInputKeySchema = z
  .string()
  .min(1)
  .max(120)
  .refine((key) => key === key.trim(), {
    message: "Les clés d'entrée ne doivent pas contenir d'espaces superflus.",
  });

export const capabilityRiskSchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export const actionPlanContextSourceSchema = z
  .object({
    type: z.literal("external_untrusted_data"),
    sourceId: identifierSchema,
    sourceIntegrity: z.literal("verified"),
    truncated: z.boolean(),
    instructionsAllowed: z.literal(false),
    toolAccess: z.literal("forbidden"),
    policyMutation: z.literal("forbidden"),
  })
  .strict();

const actionPlanStepInputSchema = z.preprocess(
  (rawInput, context) => {
    const jsonProjection = projectSimpleJsonValue(
      rawInput,
      [],
      new WeakSet<object>(),
      0,
      maximumActionPlanInputDepth,
      {
        remainingProperties: maximumActionPlanJsonProperties,
        remainingCharacters: maximumActionPlanInputCharacters,
      },
    );
    if (!jsonProjection.success) {
      context.addIssue({
        code: "custom",
        message:
          "Les entrées de l'étape doivent contenir uniquement des valeurs JSON simples.",
        path: jsonProjection.path,
      });
      return z.NEVER;
    }
    return jsonProjection.value;
  },
  z
    .record(actionPlanInputKeySchema, z.unknown())
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
      if (
        serialized === null ||
        serialized.length > maximumActionPlanInputCharacters
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Les entrées de l'étape doivent être sérialisables et bornées.",
        });
      }
    }),
);

export const actionPlanStepSchema = z
  .object({
    stepId: identifierSchema,
    capability: capabilityNameSchema,
    providerPreference: z.array(identifierSchema).max(5).default([]),
    input: actionPlanStepInputSchema,
    risk: capabilityRiskSchema,
    requiresApproval: z.boolean(),
    reversible: z.union([z.boolean(), z.literal("compensation_only")]),
    evidenceRequired: z.array(businessTextSchema).min(1).max(8),
    idempotencyKey: identifierSchema,
  })
  .strict();

const actionPlanObjectSchema = z
  .object({
    intent: businessTextSchema,
    businessGoal: businessTextSchema,
    confidence: z.number().min(0).max(1),
    missingContextQuestions: z.array(businessTextSchema).max(3),
    contextSources: z
      .array(actionPlanContextSourceSchema)
      .max(10)
      .superRefine((sources, context) => {
        const sourceIds = new Set<string>();
        for (const [index, source] of sources.entries()) {
          if (sourceIds.has(source.sourceId)) {
            context.addIssue({
              code: "custom",
              message: "Chaque source de contexte doit être unique.",
              path: [index, "sourceId"],
            });
          }
          sourceIds.add(source.sourceId);
        }
      })
      .default([]),
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

export const actionPlanSchema = z.preprocess(
  (rawPlan, context) => {
    const jsonProjection = projectSimpleJsonValue(
      rawPlan,
      [],
      new WeakSet<object>(),
      0,
      maximumActionPlanDepth,
    );
    if (!jsonProjection.success) {
      context.addIssue({
        code: "custom",
        message: "Le plan doit contenir uniquement des valeurs JSON simples.",
        path: jsonProjection.path,
      });
      return z.NEVER;
    }
    return jsonProjection.value;
  },
  actionPlanObjectSchema,
);

export const generatedActionPlanEnvelopeSchema = z.preprocess(
  (rawEnvelope, context) => {
    const jsonProjection = projectSimpleJsonValue(
      rawEnvelope,
      [],
      new WeakSet<object>(),
      0,
      maximumGeneratedActionPlanDepth,
    );
    if (!jsonProjection.success) {
      context.addIssue({
        code: "custom",
        message:
          "La proposition générée doit contenir uniquement des valeurs JSON simples.",
        path: jsonProjection.path,
      });
      return z.NEVER;
    }
    return jsonProjection.value;
  },
  z
    .object({
      generationSource: z.unknown(),
      modelReference: z.unknown().optional(),
      plan: z.unknown(),
    })
    .strict(),
);

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

export const actionPlanListSchema = z
  .object({ threadId: identifierSchema })
  .strict();

export const actionPlanExecutionSchema = z
  .object({ planId: identifierSchema })
  .strict();

export type CapabilityRisk = z.infer<typeof capabilityRiskSchema>;
export type ActionPlanStep = z.infer<typeof actionPlanStepSchema>;
export type ActionPlanContextSource = z.infer<
  typeof actionPlanContextSourceSchema
>;
// Le type d'entrée conserve la compatibilité des générateurs et fixtures
// historiques; `actionPlanSchema.parse` matérialise toujours `contextSources`.
export type ActionPlan = z.input<typeof actionPlanObjectSchema>;
export type ValidatedActionPlan = z.output<typeof actionPlanObjectSchema>;
export type ActionPlanProposal = z.infer<typeof actionPlanProposalSchema>;
export type ActionPlanCreation = z.infer<typeof actionPlanCreationSchema>;
export type ActionPlanDecision = z.infer<typeof actionPlanDecisionSchema>;
export type ActionPlanList = z.infer<typeof actionPlanListSchema>;
export type ActionPlanExecution = z.infer<typeof actionPlanExecutionSchema>;

function safelySerializeInput(input: Record<string, unknown>) {
  try {
    return JSON.stringify(input) ?? null;
  } catch {
    return null;
  }
}

type SimpleJsonProjection =
  | { success: true; value: unknown }
  | { success: false; path: Array<string | number> };

type SimpleJsonProjectionBudget = {
  remainingProperties: number;
  remainingCharacters: number;
};

function projectSimpleJsonValue(
  value: unknown,
  path: Array<string | number> = [],
  ancestors = new WeakSet<object>(),
  depth = 0,
  maximumDepth = maximumActionPlanInputDepth,
  budget: SimpleJsonProjectionBudget = {
    remainingProperties: maximumActionPlanJsonProperties,
    remainingCharacters: maximumActionPlanJsonCharacters,
  },
): SimpleJsonProjection {
  if (value === null || typeof value === "boolean") {
    return { success: true, value };
  }
  if (typeof value === "string") {
    if (value.length > budget.remainingCharacters) {
      return { success: false, path };
    }
    budget.remainingCharacters -= value.length;
    return { success: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { success: true, value }
      : { success: false, path };
  }
  if (!value || typeof value !== "object") {
    return { success: false, path };
  }
  if (depth > maximumDepth || ancestors.has(value)) {
    return { success: false, path };
  }
  ancestors.add(value);

  try {
    let isArray: boolean;
    let prototype: object | null;
    let ownKeys: Array<string | symbol>;
    try {
      isArray = Array.isArray(value);
      prototype = Object.getPrototypeOf(value);
      ownKeys = Reflect.ownKeys(value);
    } catch {
      return { success: false, path };
    }
    const expectedPrototype = isArray ? Array.prototype : Object.prototype;
    if (prototype !== expectedPrototype && prototype !== null) {
      return { success: false, path };
    }
    if (
      ownKeys.some((key) => typeof key === "symbol") ||
      ownKeys.length > budget.remainingProperties
    ) {
      return { success: false, path };
    }
    budget.remainingProperties -= ownKeys.length;
    for (const ownKey of ownKeys) {
      if (isArray && ownKey === "length") continue;
      const keyLength = (ownKey as string).length;
      if (keyLength > budget.remainingCharacters) {
        return { success: false, path };
      }
      budget.remainingCharacters -= keyLength;
    }

    const projectedValue: Record<string, unknown> | unknown[] = isArray
      ? []
      : Object.create(null);
    let arrayLength: number | null = null;
    const projectedArrayIndices: number[] = [];

    for (const ownKey of ownKeys) {
      const key = ownKey as string;
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        return { success: false, path };
      }
      if (!descriptor || !("value" in descriptor)) {
        return { success: false, path: [...path, key] };
      }

      if (isArray && key === "length") {
        if (
          typeof descriptor.value !== "number" ||
          !Number.isSafeInteger(descriptor.value) ||
          descriptor.value < 0
        ) {
          return { success: false, path };
        }
        arrayLength = descriptor.value;
        continue;
      }

      const normalizedKey = key.trim().toLowerCase();
      const arrayIndex = isArray ? Number(key) : null;
      const nextPath = [...path, isArray ? (arrayIndex as number) : key];
      if (
        (!descriptor.enumerable && !isArray) ||
        forbiddenJsonObjectKey.test(normalizedKey) ||
        (isArray &&
          (!/^(?:0|[1-9]\d*)$/u.test(key) ||
            !Number.isSafeInteger(arrayIndex) ||
            (arrayIndex as number) >= 4_294_967_295))
      ) {
        return { success: false, path: nextPath };
      }
      if (arrayIndex !== null) projectedArrayIndices.push(arrayIndex);

      const nestedProjection = projectSimpleJsonValue(
        descriptor.value,
        nextPath,
        ancestors,
        depth + 1,
        maximumDepth,
        budget,
      );
      if (!nestedProjection.success) return nestedProjection;
      Object.defineProperty(projectedValue, key, {
        value: nestedProjection.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }

    if (isArray) {
      if (
        arrayLength === null ||
        projectedArrayIndices.length !== arrayLength ||
        projectedArrayIndices.some((index) => index >= arrayLength)
      ) {
        return { success: false, path };
      }
      (projectedValue as unknown[]).length = arrayLength;
    }
    return { success: true, value: projectedValue };
  } finally {
    ancestors.delete(value);
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
