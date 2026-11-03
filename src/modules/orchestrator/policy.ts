import type { Role } from "@/lib/types";
import { hashToken, toJson } from "@/lib/security";
import {
  os3MockCapabilityManifest,
  type GenericCapabilityDefinition,
} from "@/modules/connector-execution/capabilities";
import {
  conversationActionPlanAllowedRoles,
  conversationActionPlanProviderAllowlist,
  resolveConversationPlanProviderPreference,
  validateActionPlan,
  type ConversationActionPlanProviderKey,
} from "@/modules/orchestrator/capabilities";
import { OrchestratorError } from "@/modules/orchestrator/errors";
import {
  actionPlanSchema,
  capabilityRiskSchema,
  type CapabilityRisk,
} from "@/modules/orchestrator/schemas";
import { z } from "zod";

export {
  conversationActionPlanAllowedRoles,
  conversationActionPlanProviderAllowlist,
  resolveConversationPlanProviderPreference,
};
export type { ConversationActionPlanProviderKey };

export const conversationActionPlanPolicyReceiptSchemaVersion = 1 as const;
export const conversationActionPlanPolicyCatalogProjectionVersion = 1 as const;
export const conversationActionPlanCanonicalProviderKey =
  conversationActionPlanProviderAllowlist[0];
export const conversationActionPlanCanonicalProviderVersion =
  os3MockCapabilityManifest.providerVersion;

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const roleSchema = z.enum([
  "owner",
  "administrator",
  "manager",
  "collaborator",
  "read-only",
]);
const capabilityNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
const canonicalStringArraySchema = z
  .array(z.string().trim().min(1).max(160))
  .superRefine(assertCanonicalUniqueStrings);

const projectedCapabilitySchema = z
  .object({
    name: capabilityNameSchema,
    mode: z.enum(["read", "write"]),
    executionEnvironment: z.literal("mock"),
    risk: capabilityRiskSchema,
    approval: z.enum(["none", "single"]),
    reversible: z.union([z.boolean(), z.literal("compensation_only")]),
    compensation: capabilityNameSchema.nullable(),
    requiredScopes: canonicalStringArraySchema,
    idempotency: z.literal("required"),
    maxBatchSize: z.number().int().positive().max(100_000),
    dataCategories: canonicalStringArraySchema,
    costModel: z
      .object({ unit: z.literal("request"), estimate: z.literal(0) })
      .strict(),
  })
  .strict();

export const conversationActionPlanPolicyCatalogProjectionSchema = z
  .object({
    projectionSchemaVersion: z.literal(
      conversationActionPlanPolicyCatalogProjectionVersion,
    ),
    manifestSchemaVersion: z.number().int().positive(),
    providerKey: z.literal("tradikom_mock"),
    providerVersion: z.string().trim().min(1).max(64),
    executionEnvironment: z.literal("mock"),
    status: z.literal("mock"),
    auth: z.literal("none"),
    allowedRoles: z.array(roleSchema).superRefine(assertCanonicalUniqueStrings),
    capabilities: z
      .array(projectedCapabilitySchema)
      .min(1)
      .max(256)
      .superRefine((capabilities, context) => {
        assertCanonicalUniqueStrings(
          capabilities.map((capability) => capability.name),
          context,
        );
      }),
  })
  .strict();

const approvalSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("none"),
      id: z.null(),
      status: z.literal("not_required"),
    })
    .strict(),
  z
    .object({
      mode: z.literal("single"),
      id: identifierSchema,
      status: z.literal("approved"),
    })
    .strict(),
]);

const policyRiskStepSchema = z
  .object({
    stepId: identifierSchema,
    capability: capabilityNameSchema,
    level: capabilityRiskSchema,
  })
  .strict();

export const conversationActionPlanPolicyReceiptPayloadSchema = z
  .object({
    schemaVersion: z.literal(conversationActionPlanPolicyReceiptSchemaVersion),
    tenantId: identifierSchema,
    plan: z
      .object({ id: identifierSchema, fingerprint: fingerprintSchema })
      .strict(),
    approval: approvalSchema,
    catalog: z
      .object({
        fingerprint: fingerprintSchema,
        projection: conversationActionPlanPolicyCatalogProjectionSchema,
      })
      .strict(),
    provider: z
      .object({
        key: z.literal("tradikom_mock"),
        version: z.string().trim().min(1).max(64),
        executionEnvironment: z.literal("mock"),
      })
      .strict(),
    authorization: z
      .object({
        role: roleSchema,
        allowedRoles: z
          .array(roleSchema)
          .superRefine(assertCanonicalUniqueStrings),
        requiredScopes: canonicalStringArraySchema,
      })
      .strict(),
    capabilities: canonicalStringArraySchema,
    risk: z
      .object({
        maximum: capabilityRiskSchema,
        steps: z
          .array(policyRiskStepSchema)
          .min(1)
          .max(12)
          .superRefine((steps, context) => {
            assertCanonicalUniqueStrings(
              steps.map((step) => step.stepId),
              context,
            );
          }),
      })
      .strict(),
  })
  .strict();

export const conversationActionPlanPolicyReceiptSchema = z
  .object({
    payload: conversationActionPlanPolicyReceiptPayloadSchema,
    fingerprint: fingerprintSchema,
  })
  .strict();

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type ConversationActionPlanPolicyApproval = z.infer<
  typeof approvalSchema
>;
export type ConversationActionPlanPolicyCatalogProjection = DeepReadonly<
  z.infer<typeof conversationActionPlanPolicyCatalogProjectionSchema>
>;
export type ConversationActionPlanPolicyReceiptPayload = DeepReadonly<
  z.infer<typeof conversationActionPlanPolicyReceiptPayloadSchema>
>;
export type ConversationActionPlanPolicyReceipt = DeepReadonly<
  z.infer<typeof conversationActionPlanPolicyReceiptSchema>
>;

export type ConversationActionPlanPolicyCatalogSource = {
  schemaVersion: number;
  providerKey: string;
  providerVersion: string;
  environment: string;
  status: string;
  auth: string;
  capabilities: readonly GenericCapabilityDefinition[];
};

export type CompileConversationActionPlanPolicyReceiptInput = {
  tenantId: string;
  planId: string;
  planJson: string;
  planFingerprint: string;
  approval: ConversationActionPlanPolicyApproval;
  role: Role;
  grantedScopes: readonly string[];
  catalog?: ConversationActionPlanPolicyCatalogSource;
};

export function projectConversationActionPlanPolicyCatalog(
  source: ConversationActionPlanPolicyCatalogSource = os3MockCapabilityManifest,
): ConversationActionPlanPolicyCatalogProjection {
  try {
    if (source.providerKey !== conversationActionPlanCanonicalProviderKey) {
      throw new OrchestratorError(
        "orchestrator_provider_not_allowed",
        "Le fournisseur du catalogue n'est pas autorisé.",
      );
    }
    const names = source.capabilities.map((capability) => capability.name);
    if (new Set(names).size !== names.length) {
      throw new Error("duplicate capability");
    }
    const projection = conversationActionPlanPolicyCatalogProjectionSchema.parse({
      projectionSchemaVersion:
        conversationActionPlanPolicyCatalogProjectionVersion,
      manifestSchemaVersion: source.schemaVersion,
      providerKey: source.providerKey,
      providerVersion: source.providerVersion,
      executionEnvironment: source.environment,
      status: source.status,
      auth: source.auth,
      allowedRoles: sortUniqueStrings(conversationActionPlanAllowedRoles),
      capabilities: source.capabilities
        .map((capability) => ({
          name: capability.name,
          mode: capability.mode,
          executionEnvironment: capability.executionEnvironment,
          risk: capability.risk,
          approval: capability.approval,
          reversible: capability.reversible,
          compensation: capability.compensation,
          requiredScopes: sortUniqueStrings(capability.requiredScopes),
          idempotency: capability.idempotency,
          maxBatchSize: capability.maxBatchSize,
          dataCategories: sortUniqueStrings(capability.dataCategories),
          costModel: {
            unit: capability.costModel.unit,
            estimate: capability.costModel.estimate,
          },
        }))
        .sort((left, right) => compareCanonicalStrings(left.name, right.name)),
    });
    return detachAndDeepFreeze(projection);
  } catch (error) {
    if (error instanceof OrchestratorError) throw error;
    throw invalidPolicyReceipt(
      "Le catalogue de capacités ne respecte pas la policy serveur.",
    );
  }
}

export function compileConversationActionPlanPolicyReceipt(
  input: CompileConversationActionPlanPolicyReceiptInput,
): ConversationActionPlanPolicyReceipt {
  const identity = parsePolicyIdentity(input);
  if (hashToken(input.planJson) !== identity.planFingerprint) {
    throw invalidPolicyReceipt("L'empreinte du plan ne correspond pas à son contenu.");
  }

  const rawPlan = parsePlanJson(input.planJson);
  const catalogSource = input.catalog ?? os3MockCapabilityManifest;
  const catalogProjection = projectConversationActionPlanPolicyCatalog(
    catalogSource,
  );
  let plan: ReturnType<typeof actionPlanSchema.parse>;
  try {
    plan = actionPlanSchema.parse(rawPlan);
  } catch {
    throw invalidPolicyReceipt("Le plan ne respecte pas son schéma serveur.");
  }
  const validated = validateActionPlan(plan, {
    role: input.role,
    grantedScopes: [...input.grantedScopes],
    catalog: [...catalogSource.capabilities],
  });
  let approval: ConversationActionPlanPolicyApproval;
  try {
    approval = approvalSchema.parse(input.approval);
  } catch {
    throw invalidPolicyReceipt("La validation liée au plan est invalide.");
  }
  if (approval.mode !== validated.approval.mode) {
    throw invalidPolicyReceipt(
      "La validation ne correspond pas à la policy des capacités.",
    );
  }

  const providers = plan.steps.map((step) =>
    resolveConversationPlanProviderPreference(step.providerPreference),
  );
  const providerKey = assertSingleCanonicalProvider(providers);
  if (catalogProjection.providerKey !== providerKey) {
    throw new OrchestratorError(
      "orchestrator_provider_not_allowed",
      "Le fournisseur du catalogue n'est pas autorisé pour ce plan.",
    );
  }

  const requiredScopes = sortUniqueStrings(
    plan.steps.flatMap((step) => {
      const capability = catalogSource.capabilities.find(
        (entry) => entry.name === step.capability,
      );
      if (!capability) {
        throw new OrchestratorError(
          "orchestrator_capability_unavailable",
          `La capacité ${step.capability} n'est pas disponible.`,
        );
      }
      return capability.requiredScopes;
    }),
  );
  const riskSteps = plan.steps
    .map((step) => ({
      stepId: step.stepId,
      capability: step.capability,
      level: step.risk,
    }))
    .sort((left, right) => compareCanonicalStrings(left.stepId, right.stepId));
  const catalogFingerprint = hashToken(toJson(catalogProjection));
  const payload = conversationActionPlanPolicyReceiptPayloadSchema.parse({
    schemaVersion: conversationActionPlanPolicyReceiptSchemaVersion,
    tenantId: identity.tenantId,
    plan: { id: identity.planId, fingerprint: identity.planFingerprint },
    approval,
    catalog: {
      fingerprint: catalogFingerprint,
      projection: catalogProjection,
    },
    provider: {
      key: providerKey,
      version: catalogProjection.providerVersion,
      executionEnvironment: "mock",
    },
    authorization: {
      role: input.role,
      allowedRoles: sortUniqueStrings(conversationActionPlanAllowedRoles),
      requiredScopes,
    },
    capabilities: sortUniqueStrings(
      plan.steps.map((step) => step.capability),
    ),
    risk: {
      maximum: maximumRisk(riskSteps.map((step) => step.level)),
      steps: riskSteps,
    },
  });
  const detachedPayload = detachAndDeepFreeze(payload);
  return detachAndDeepFreeze({
    payload: detachedPayload,
    fingerprint: hashToken(toJson(detachedPayload)),
  });
}

export function verifyConversationActionPlanPolicyReceipt(
  receipt: unknown,
  input: CompileConversationActionPlanPolicyReceiptInput,
): ConversationActionPlanPolicyReceipt {
  let parsed: z.infer<typeof conversationActionPlanPolicyReceiptSchema>;
  try {
    parsed = conversationActionPlanPolicyReceiptSchema.parse(receipt);
  } catch {
    throw invalidPolicyReceipt("Le reçu de policy est absent ou malformé.");
  }
  if (hashToken(toJson(parsed.payload)) !== parsed.fingerprint) {
    throw invalidPolicyReceipt("L'empreinte du reçu de policy est invalide.");
  }
  if (
    hashToken(toJson(parsed.payload.catalog.projection)) !==
    parsed.payload.catalog.fingerprint
  ) {
    throw invalidPolicyReceipt("L'empreinte du catalogue est invalide.");
  }

  const expected = compileConversationActionPlanPolicyReceipt(input);
  if (
    parsed.fingerprint !== expected.fingerprint ||
    toJson(parsed.payload) !== toJson(expected.payload)
  ) {
    throw invalidPolicyReceipt(
      "Le reçu de policy ne correspond plus à l'état autorisé du plan.",
    );
  }
  return detachAndDeepFreeze(parsed);
}

function parsePolicyIdentity(input: CompileConversationActionPlanPolicyReceiptInput) {
  try {
    return {
      tenantId: identifierSchema.parse(input.tenantId),
      planId: identifierSchema.parse(input.planId),
      planFingerprint: fingerprintSchema.parse(input.planFingerprint),
    };
  } catch {
    throw invalidPolicyReceipt("L'identité du plan est invalide.");
  }
}

function parsePlanJson(planJson: string) {
  try {
    return JSON.parse(planJson) as unknown;
  } catch {
    throw invalidPolicyReceipt("Le contenu sérialisé du plan est invalide.");
  }
}

function assertSingleCanonicalProvider(
  providers: readonly ConversationActionPlanProviderKey[],
): ConversationActionPlanProviderKey {
  const uniqueProviders = sortUniqueStrings(providers);
  if (
    uniqueProviders.length !== 1 ||
    uniqueProviders[0] !== conversationActionPlanProviderAllowlist[0]
  ) {
    throw new OrchestratorError(
      "orchestrator_provider_not_allowed",
      "Le plan doit utiliser un fournisseur canonique unique.",
    );
  }
  return conversationActionPlanProviderAllowlist[0];
}

const riskRank: Record<CapabilityRisk, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function maximumRisk(risks: readonly CapabilityRisk[]): CapabilityRisk {
  if (risks.length === 0) {
    throw invalidPolicyReceipt("Le reçu de policy exige au moins un risque.");
  }
  return risks.reduce((maximum, risk) =>
    riskRank[risk] > riskRank[maximum] ? risk : maximum,
  );
}

function sortUniqueStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareCanonicalStrings);
}

function compareCanonicalStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertCanonicalUniqueStrings(
  values: readonly string[],
  context: z.RefinementCtx,
) {
  const canonical = sortUniqueStrings(values);
  if (
    canonical.length !== values.length ||
    canonical.some((value, index) => value !== values[index])
  ) {
    context.addIssue({
      code: "custom",
      message: "Les valeurs doivent être uniques et triées canoniquement.",
    });
  }
}

function detachAndDeepFreeze<T>(value: T): DeepReadonly<T> {
  const detached = JSON.parse(toJson(value)) as T;
  return deepFreeze(detached);
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function invalidPolicyReceipt(message: string) {
  return new OrchestratorError("orchestrator_policy_receipt_invalid", message);
}
