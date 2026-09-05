import { z } from "zod";
import { hashToken } from "@/lib/security";
import {
  findOs3MockCapability,
  os3MockCapabilityManifest,
  type Os3MockCapabilityName,
} from "@/modules/connector-execution/capabilities";

export type CapabilityFailureClassification =
  | "temporary"
  | "permanent"
  | "rate_limit"
  | "policy"
  | "validation"
  | "not_configured";

export class CapabilityProviderFailure extends Error {
  constructor(
    public readonly classification: "temporary" | "permanent" | "rate_limit",
    message: string,
  ) {
    super(message);
    this.name = "CapabilityProviderFailure";
  }
}

export class CapabilityRuntimeError extends Error {
  constructor(
    public readonly classification: CapabilityFailureClassification,
    message: string,
    public readonly retryable: boolean,
    public readonly attempts: number,
  ) {
    super(message);
    this.name = "CapabilityRuntimeError";
  }
}

export type CapabilityProvider = {
  key: string;
  version: string;
  environment: "mock";
  status: "mock" | "disabled" | "not_configured";
  execute(input: {
    capability: Os3MockCapabilityName;
    tenantId: string;
    idempotencyKey: string;
    input: unknown;
  }): Promise<unknown>;
  compensate(input: {
    capability: Os3MockCapabilityName;
    tenantId: string;
    idempotencyKey: string;
    output: unknown;
  }): Promise<unknown>;
};

export type ExecuteGenericCapabilityInput = {
  tenantId: string;
  capability: string;
  environment: "mock" | "sandbox" | "production";
  input: unknown;
  idempotencyKey: string;
  maxAttempts?: number;
};

export const strictMockCapabilityProvider: CapabilityProvider = {
  key: os3MockCapabilityManifest.providerKey,
  version: os3MockCapabilityManifest.providerVersion,
  environment: "mock",
  status: "mock",
  async execute({ capability, tenantId, idempotencyKey, input }) {
    if (capability === "crm.contacts.search") {
      return { matchCount: 1 };
    }
    if (capability === "project.task.create") {
      const parsed = z.object({ title: z.string() }).passthrough().parse(input);
      return {
        taskReference: `tache_mock_${hashToken(
          `${tenantId}:${idempotencyKey}:${parsed.title}`,
        ).slice(0, 24)}`,
      };
    }
    throw new CapabilityProviderFailure(
      "permanent",
      "La capacité demandée n'est pas prise en charge par le provider mock.",
    );
  },
  async compensate({ capability, output }) {
    if (capability !== "project.task.create") {
      throw new CapabilityProviderFailure(
        "permanent",
        "Cette capacité ne possède pas de compensation mock.",
      );
    }
    const parsed = z
      .object({ taskReference: z.string().min(1) })
      .strict()
      .parse(output);
    return { archivedReference: parsed.taskReference };
  },
};

export async function executeGenericCapability(
  input: ExecuteGenericCapabilityInput,
  provider: CapabilityProvider = strictMockCapabilityProvider,
) {
  const capability = findOs3MockCapability(input.capability);
  if (!capability) {
    throw new CapabilityRuntimeError(
      "not_configured",
      "La capacité demandée n'est pas disponible.",
      false,
      0,
    );
  }
  if (input.environment !== "mock") {
    throw new CapabilityRuntimeError(
      "policy",
      "Seule l'exécution mock est autorisée dans cette tranche.",
      false,
      0,
    );
  }
  if (
    provider.status !== "mock" ||
    provider.environment !== "mock" ||
    provider.key !== os3MockCapabilityManifest.providerKey ||
    provider.version !== os3MockCapabilityManifest.providerVersion
  ) {
    throw new CapabilityRuntimeError(
      "not_configured",
      "Aucun provider mock approuvé n'est configuré.",
      false,
      0,
    );
  }

  const parsedInput = parseOrThrow(
    capability.inputSchema,
    input.input,
    "input",
    0,
  );
  const maxAttempts = Math.min(
    3,
    Math.max(1, Math.trunc(input.maxAttempts ?? 3)),
  );
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const rawOutput = await provider.execute({
        capability: capability.name,
        tenantId: input.tenantId,
        idempotencyKey: input.idempotencyKey,
        input: parsedInput,
      });
      const output = parseOrThrow(
        capability.outputSchema,
        rawOutput,
        "output",
        attempts,
      );
      return {
        capability: capability.name,
        providerKey: provider.key,
        providerVersion: provider.version,
        manifestVersion: os3MockCapabilityManifest.schemaVersion,
        environment: "mock" as const,
        status: "succeeded" as const,
        attempts,
        output,
        evidence: {
          code:
            capability.name === "crm.contacts.search"
              ? "mock_contact_matches"
              : "mock_task_prepared",
          externalSideEffect: false as const,
          inputStored: false as const,
        },
        compensation: capability.compensation
          ? { available: true as const, capability: capability.compensation }
          : { available: false as const, capability: null },
      };
    } catch (error) {
      const normalized = normalizeProviderFailure(error, attempts);
      if (!normalized.retryable || attempts >= maxAttempts) throw normalized;
    }
  }
  throw new CapabilityRuntimeError(
    "permanent",
    "L'exécution mock a échoué.",
    false,
    attempts,
  );
}

export async function compensateGenericCapability(
  input: {
    tenantId: string;
    capability: string;
    environment: "mock" | "sandbox" | "production";
    idempotencyKey: string;
    output: unknown;
  },
  provider: CapabilityProvider = strictMockCapabilityProvider,
) {
  const capability = findOs3MockCapability(input.capability);
  if (!capability?.compensation) {
    throw new CapabilityRuntimeError(
      "policy",
      "Aucune compensation n'est déclarée pour cette capacité.",
      false,
      0,
    );
  }
  if (
    input.environment !== "mock" ||
    provider.status !== "mock" ||
    provider.environment !== "mock" ||
    provider.key !== os3MockCapabilityManifest.providerKey ||
    provider.version !== os3MockCapabilityManifest.providerVersion
  ) {
    throw new CapabilityRuntimeError(
      "policy",
      "La compensation réelle n'est pas autorisée dans cette tranche.",
      false,
      0,
    );
  }
  try {
    const result = await provider.compensate({
      capability: capability.name,
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      output: input.output,
    });
    return {
      status: "compensated" as const,
      capability: capability.name,
      compensationCapability: capability.compensation,
      environment: "mock" as const,
      externalSideEffect: false as const,
      result,
    };
  } catch (error) {
    throw normalizeProviderFailure(error, 1);
  }
}

function parseOrThrow(
  schema: z.ZodTypeAny,
  value: unknown,
  kind: "input" | "output",
  attempts: number,
) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new CapabilityRuntimeError(
    "validation",
    kind === "input"
      ? "Les données de la capacité sont invalides."
      : "La preuve retournée par le provider est invalide.",
    false,
    attempts,
  );
}

function normalizeProviderFailure(error: unknown, attempts: number) {
  if (error instanceof CapabilityRuntimeError) return error;
  if (error instanceof CapabilityProviderFailure) {
    return new CapabilityRuntimeError(
      error.classification,
      error.classification === "temporary"
        ? "Le provider mock est temporairement indisponible."
        : error.classification === "rate_limit"
          ? "Le quota du provider mock est temporairement épuisé."
          : "Le provider mock a refusé définitivement l'opération.",
      error.classification === "temporary" || error.classification === "rate_limit",
      attempts,
    );
  }
  return new CapabilityRuntimeError(
    "permanent",
    "Le provider mock a échoué de manière définitive.",
    false,
    attempts,
  );
}
