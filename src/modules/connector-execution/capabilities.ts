import { z } from "zod";

export type CapabilityRisk = "low" | "medium" | "high" | "critical";
export type CapabilityApproval = "none" | "single";

export type GenericCapabilityDefinition = {
  name: string;
  description: string;
  mode: "read" | "write";
  executionEnvironment: "mock";
  risk: CapabilityRisk;
  approval: CapabilityApproval;
  reversible: boolean | "compensation_only";
  compensation: string | null;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  requiredScopes: string[];
  idempotency: "required";
  maxBatchSize: number;
  dataCategories: string[];
  costModel: { unit: "request"; estimate: 0 };
};

const contactSearchInputSchema = z
  .object({ query: z.string().trim().min(1).max(200) })
  .strict();
const contactSearchOutputSchema = z
  .object({ matchCount: z.number().int().nonnegative().max(20) })
  .strict();
const taskCreateInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    dueAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
const taskCreateOutputSchema = z
  .object({ taskReference: z.string().trim().min(1).max(160) })
  .strict();

export const os3MockCapabilityManifest = {
  schemaVersion: 1,
  providerKey: "tradikom_mock",
  providerVersion: "1.0.0",
  displayName: "Runtime de démonstration TRADIKOM",
  environment: "mock" as const,
  status: "mock" as const,
  auth: "none" as const,
  capabilities: [
    {
      name: "crm.contacts.search",
      description: "Recherche déterministe de contacts de démonstration.",
      mode: "read",
      executionEnvironment: "mock",
      risk: "low",
      approval: "none",
      reversible: true,
      compensation: null,
      inputSchema: contactSearchInputSchema,
      outputSchema: contactSearchOutputSchema,
      requiredScopes: ["crm.contacts.read"],
      idempotency: "required",
      maxBatchSize: 20,
      dataCategories: ["contacts"],
      costModel: { unit: "request", estimate: 0 },
    },
    {
      name: "project.task.create",
      description: "Création déterministe d'une tâche de démonstration.",
      mode: "write",
      executionEnvironment: "mock",
      risk: "medium",
      approval: "single",
      reversible: true,
      compensation: "project.task.archive",
      inputSchema: taskCreateInputSchema,
      outputSchema: taskCreateOutputSchema,
      requiredScopes: ["project.tasks.write"],
      idempotency: "required",
      maxBatchSize: 1,
      dataCategories: ["operational_tasks"],
      costModel: { unit: "request", estimate: 0 },
    },
  ] satisfies GenericCapabilityDefinition[],
};

export const os3MockCapabilityCatalog =
  os3MockCapabilityManifest.capabilities;

export type Os3MockCapabilityName =
  (typeof os3MockCapabilityCatalog)[number]["name"];

export function findOs3MockCapability(name: string) {
  return os3MockCapabilityCatalog.find((capability) => capability.name === name);
}
