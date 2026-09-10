import { hashToken } from "@/lib/security";
import { OrchestratorError } from "@/modules/orchestrator/errors";
import {
  actionPlanContextSourceSchema,
  type ActionPlan,
  type ActionPlanContextSource,
  type ValidatedActionPlan,
} from "@/modules/orchestrator/schemas";

export const maximumActionPlanContextSources = 10;
export const maximumActionPlanContextCharacters = 16_000;
export const minimumExternalContextWholeCopyCharacters = 32;
export const minimumExternalContextVerbatimCharacters = 48;

const minimumExternalContextDenseTokenCharacters = 32;
const minimumExternalContextCompactVerbatimCharacters =
  minimumExternalContextVerbatimCharacters;
const minimumExternalContextCumulativeChunkCharacters = 12;
const minimumExternalContextCumulativeCopyCharacters = 48;
const maskedExternalContextPattern =
  /\[(?:secret|lien|adresse interne|contenu)\s+masqu(?:e|ee|é|ée)\]/giu;

export type ActionPlanGenerationContextSource = ActionPlanContextSource & {
  content: string;
};

export type ActionPlanGenerationContext = {
  tenantId: string;
  threadId: string;
  sourceMessageId: string;
  sourceText: string | null;
  contextSources?: readonly ActionPlanGenerationContextSource[];
};

export type GeneratedActionPlan = {
  generationSource: "deterministic_mock" | "model";
  modelReference?: string;
  plan: ActionPlan;
};

export interface ActionPlanGenerator {
  generate(
    context: ActionPlanGenerationContext,
  ): Promise<GeneratedActionPlan>;
}

export function assertGeneratedActionPlanDoesNotCopyExternalContext(
  plan: ValidatedActionPlan,
  sources: readonly ActionPlanGenerationContextSource[],
  additionalGeneratedStrings: readonly string[] = [],
) {
  if (sources.length === 0) return;

  const collected = collectGeneratedPlanStrings(plan);
  const generatedLeafStrings = [
    ...collected.leaves,
    ...additionalGeneratedStrings,
  ].map(stripMaskedExternalContext);
  const generatedCumulativeLeafStrings = [
    ...collected.cumulativeLeaves,
    ...additionalGeneratedStrings,
  ].map(stripMaskedExternalContext);
  const generatedAggregateStrings = collected.aggregates.map(
    stripMaskedExternalContext,
  );
  if (additionalGeneratedStrings.length > 0) {
    generatedAggregateStrings.push(
      stripMaskedExternalContext(
        [
          ...additionalGeneratedStrings,
          ...collected.cumulativeLeaves,
        ].join(""),
      ),
    );
  }
  const generatedStrings = [
    ...generatedLeafStrings,
    ...generatedAggregateStrings,
  ];
  const generatedSegments = generatedStrings
    .map(normalizeComparableText)
    .filter((segment) => segment.length > 0);
  const generatedCompactSegments = generatedStrings
    .map(normalizeCompactText)
    .filter((segment) => segment.length > 0);
  const generatedCompactLeaves = generatedCumulativeLeafStrings
    .map(normalizeCompactText)
    .filter((segment) => segment.length > 0);

  for (const source of sources) {
    const sourceWithoutMasks = stripMaskedExternalContext(source.content);
    const normalizedSource = normalizeComparableText(sourceWithoutMasks);
    if (normalizedSource.length === 0) continue;
    const compactSource = normalizeCompactText(sourceWithoutMasks);

    if (
      normalizedSource.length >= minimumExternalContextWholeCopyCharacters &&
      generatedSegments.some((segment) =>
        segment.includes(normalizedSource),
      )
    ) {
      throw unsafeGeneratedPlanError();
    }
    if (
      compactSource.length >= minimumExternalContextWholeCopyCharacters &&
      generatedCompactSegments.some((segment) =>
        segment.includes(compactSource),
      )
    ) {
      throw unsafeGeneratedPlanError();
    }

    const denseSourceTokens = new Set(
      sourceWithoutMasks
        .split(/\s+/u)
        .map(normalizeCompactText)
        .filter(
          (token) => token.length >= minimumExternalContextDenseTokenCharacters,
        ),
    );
    if (
      denseSourceTokens.size > 0 &&
      generatedCompactSegments.some((segment) =>
        [...denseSourceTokens].some((token) => segment.includes(token)),
      )
    ) {
      throw unsafeGeneratedPlanError();
    }

    const sourceVerbatimWindows = collectComparableWindows(
      [normalizedSource],
      minimumExternalContextVerbatimCharacters,
    );
    if (
      containsComparableWindow(
        generatedSegments,
        sourceVerbatimWindows,
        minimumExternalContextVerbatimCharacters,
      )
    ) {
      throw unsafeGeneratedPlanError();
    }

    const sourceCompactWindows = collectComparableWindows(
      [compactSource],
      minimumExternalContextCompactVerbatimCharacters,
    );
    if (
      containsComparableWindow(
        generatedCompactSegments,
        sourceCompactWindows,
        minimumExternalContextCompactVerbatimCharacters,
      )
    ) {
      throw unsafeGeneratedPlanError();
    }
    if (
      compactSource.length >= minimumExternalContextWholeCopyCharacters
    ) {
      const cumulativeCopyLimit = Math.min(
        minimumExternalContextCumulativeCopyCharacters,
        compactSource.length,
      );
      if (
        countCompleteGeneratedLeafCharactersCopiedFromSource(
          compactSource,
          generatedCompactLeaves,
        ) >= cumulativeCopyLimit ||
        countGeneratedCharactersCoveredBySourceChunks(
          compactSource,
          generatedCompactLeaves,
          minimumExternalContextCumulativeChunkCharacters,
        ) >= cumulativeCopyLimit
      ) {
        throw unsafeGeneratedPlanError();
      }
    }
  }
}

export function createDeterministicActionPlanGenerator(): ActionPlanGenerator {
  return {
    async generate(context) {
      const sourceFingerprint = hashToken(context.sourceMessageId).slice(0, 32);
      const contextSources = boundActionPlanGenerationContextSources(
        context.contextSources ?? [],
      );
      return {
        generationSource: "deterministic_mock",
        plan: {
          intent: "Préparer une relance commerciale",
          businessGoal:
            "Retrouver le contact lié à la conversation puis préparer une tâche de suivi.",
          confidence: context.sourceText ? 0.9 : 0.75,
          missingContextQuestions: [],
          contextSources: contextSources.map(toActionPlanContextSourceMetadata),
          riskSummary:
            "Lecture de démonstration puis création réversible d'une tâche mock.",
          estimatedCost: { amount: 0, currency: "EUR" },
          steps: [
            {
              stepId: "search_contact",
              capability: "crm.contacts.search",
              providerPreference: [],
              input: { query: "contact lié à la conversation" },
              risk: "low",
              requiresApproval: false,
              reversible: true,
              evidenceRequired: ["Nombre de contacts mock correspondants"],
              idempotencyKey: `plan:${sourceFingerprint}:search_contact`,
            },
            {
              stepId: "create_follow_up",
              capability: "project.task.create",
              providerPreference: [],
              input: { title: "Relancer le contact de la conversation" },
              risk: "medium",
              requiresApproval: true,
              reversible: true,
              evidenceRequired: ["Référence de la tâche mock"],
              idempotencyKey: `plan:${sourceFingerprint}:create_follow_up`,
            },
          ],
          finalUserMessageDraft:
            "Je propose de retrouver le contact puis de préparer une tâche de relance. Une seule validation confirmera le plan complet.",
        },
      };
    },
  };
}

export function boundActionPlanGenerationContextSources(
  sources: readonly ActionPlanGenerationContextSource[],
): ActionPlanGenerationContextSource[] {
  if (sources.length > maximumActionPlanContextSources) {
    throw new OrchestratorError(
      "orchestrator_source_context_invalid",
      "Le nombre de sources de contexte dépasse la limite autorisée.",
    );
  }

  let remainingCharacters = maximumActionPlanContextCharacters;
  const boundedSources: ActionPlanGenerationContextSource[] = [];
  for (const source of sources) {
    if (remainingCharacters === 0) break;
    const metadata = toActionPlanContextSourceMetadata(source);
    const content = source.content.slice(0, remainingCharacters);
    if (content.length === 0) continue;
    remainingCharacters -= content.length;
    boundedSources.push({
      ...metadata,
      truncated: metadata.truncated || content.length < source.content.length,
      content,
    });
  }
  return boundedSources;
}

export function toActionPlanContextSourceMetadata(
  source: ActionPlanGenerationContextSource,
): ActionPlanContextSource {
  return actionPlanContextSourceSchema.parse({
    type: source.type,
    sourceId: source.sourceId,
    sourceIntegrity: source.sourceIntegrity,
    truncated: source.truncated,
    instructionsAllowed: source.instructionsAllowed,
    toolAccess: source.toolAccess,
    policyMutation: source.policyMutation,
  });
}

function collectGeneratedPlanStrings(plan: ValidatedActionPlan) {
  const persistablePlan = Object.fromEntries(
    Object.entries(plan).filter(([key]) => key !== "contextSources"),
  );
  const persistenceProjection = JSON.parse(
    JSON.stringify(persistablePlan),
  ) as Record<string, unknown>;
  const leaves: string[] = [];
  const cumulativeLeaves: string[] = [];
  const aggregates: string[] = [];
  collectPrimitiveLeaves(persistenceProjection, leaves);
  const narrativeValues = collectNarrativeValues(persistenceProjection);
  cumulativeLeaves.push(...narrativeValues);
  if (narrativeValues.length > 1) aggregates.push(narrativeValues.join(""));

  if (Array.isArray(persistenceProjection.steps)) {
    const allInputValues: string[] = [];
    const allInputKeys: string[] = [];
    for (const step of persistenceProjection.steps) {
      if (!step || typeof step !== "object" || Array.isArray(step)) continue;
      const input = (step as Record<string, unknown>).input;
      const inputValues: string[] = [];
      const inputKeys: string[] = [];
      for (const key of [
        "stepId",
        "providerPreference",
        "idempotencyKey",
      ]) {
        collectPrimitiveLeaves(
          (step as Record<string, unknown>)[key],
          cumulativeLeaves,
        );
      }
      collectPrimitiveLeaves(input, inputValues);
      collectNestedInputKeys(
        input,
        inputKeys,
      );
      allInputValues.push(...inputValues);
      allInputKeys.push(...inputKeys);
      cumulativeLeaves.push(...inputValues, ...inputKeys);
      if (inputValues.length > 1) aggregates.push(inputValues.join(""));
      if (inputKeys.length > 1) aggregates.push(inputKeys.join(""));
      const serializedInput = JSON.stringify(input);
      if (serializedInput) aggregates.push(serializedInput);
      leaves.push(...inputKeys);
    }
    if (allInputValues.length > 1) aggregates.push(allInputValues.join(""));
    if (allInputKeys.length > 1) aggregates.push(allInputKeys.join(""));
  }
  if (cumulativeLeaves.length > 1) {
    aggregates.push(cumulativeLeaves.join(""));
  }
  return { leaves, cumulativeLeaves, aggregates };
}

function collectNarrativeValues(projection: Record<string, unknown>) {
  const narrativeValues: string[] = [];
  for (const key of [
    "intent",
    "businessGoal",
    "missingContextQuestions",
    "riskSummary",
  ]) {
    collectPrimitiveLeaves(projection[key], narrativeValues);
  }
  if (Array.isArray(projection.steps)) {
    for (const step of projection.steps) {
      if (!step || typeof step !== "object" || Array.isArray(step)) continue;
      collectPrimitiveLeaves(
        (step as Record<string, unknown>).evidenceRequired,
        narrativeValues,
      );
    }
  }
  collectPrimitiveLeaves(projection.finalUserMessageDraft, narrativeValues);
  return narrativeValues;
}

function collectPrimitiveLeaves(value: unknown, strings: string[]) {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    strings.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPrimitiveLeaves(item, strings);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const nestedValue of Object.values(value)) {
    collectPrimitiveLeaves(nestedValue, strings);
  }
}

function collectNestedInputKeys(value: unknown, strings: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectNestedInputKeys(item, strings);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, nestedValue] of Object.entries(value)) {
    strings.push(key);
    collectNestedInputKeys(nestedValue, strings);
  }
}

function stripMaskedExternalContext(value: string) {
  return value.replace(maskedExternalContextPattern, " ");
}

function normalizeComparableText(value: string) {
  return normalizeUnicodeCase(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCompactText(value: string) {
  return normalizeUnicodeCase(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeUnicodeCase(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleUpperCase("fr")
    .toLocaleLowerCase("fr")
    .replace(/ς/gu, "σ");
}

function collectComparableWindows(
  segments: readonly string[],
  windowLength: number,
) {
  const windows = new Set<string>();
  for (const segment of segments) {
    for (
      let index = 0;
      index <= segment.length - windowLength;
      index += 1
    ) {
      windows.add(segment.slice(index, index + windowLength));
    }
  }
  return windows;
}

function containsComparableWindow(
  segments: readonly string[],
  expectedWindows: ReadonlySet<string>,
  windowLength: number,
) {
  if (expectedWindows.size === 0) return false;
  for (const segment of segments) {
    for (
      let index = 0;
      index <= segment.length - windowLength;
      index += 1
    ) {
      if (expectedWindows.has(segment.slice(index, index + windowLength))) {
        return true;
      }
    }
  }
  return false;
}

function countGeneratedCharactersCoveredBySourceChunks(
  source: string,
  generatedSegments: readonly string[],
  chunkLength: number,
) {
  const sourceChunks = collectComparableWindows([source], chunkLength);
  if (sourceChunks.size === 0) return 0;

  let coveredCharacters = 0;
  for (const segment of generatedSegments) {
    let coveredUntil = 0;
    for (
      let index = 0;
      index <= segment.length - chunkLength;
      index += 1
    ) {
      const chunk = segment.slice(index, index + chunkLength);
      if (!sourceChunks.has(chunk)) continue;
      const nextCoveredUntil = index + chunkLength;
      coveredCharacters += Math.max(
        0,
        nextCoveredUntil - Math.max(index, coveredUntil),
      );
      coveredUntil = Math.max(coveredUntil, nextCoveredUntil);
      if (coveredCharacters >= source.length) return source.length;
    }
  }
  return coveredCharacters;
}

function countCompleteGeneratedLeafCharactersCopiedFromSource(
  source: string,
  generatedLeaves: readonly string[],
) {
  let copiedCharacters = 0;
  for (const leaf of new Set(generatedLeaves)) {
    if (leaf.length < 4 || !source.includes(leaf)) continue;
    copiedCharacters += leaf.length;
    if (copiedCharacters >= source.length) return source.length;
  }
  return copiedCharacters;
}

function unsafeGeneratedPlanError() {
  return new OrchestratorError(
    "orchestrator_generated_plan_unsafe",
    "Le plan généré recopie une donnée externe non fiable.",
  );
}
