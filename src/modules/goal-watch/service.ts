import { createHash } from "node:crypto";
import {
  withSystemDbTransaction,
  withTenantDbTransaction,
} from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import type { Role } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import {
  getBusinessBrainSignals,
  insertBusinessBrainEntry,
  insertBusinessBrainEvidence,
  type BusinessBrainEntryRow,
  type BusinessBrainSignalRow,
} from "@/modules/business-brain/repository";
import { findConversationThreadRow } from "@/modules/conversation-hub/repository";
import { ingestSystemConversationMessage } from "@/modules/conversation-hub/service";
import { GoalWatchError } from "@/modules/goal-watch/errors";
import {
  GOAL_WATCH_SOURCE_REF,
  findActiveGoalWatchEntry,
  findLatestGoalWatchEvaluationAudit,
  listActiveGoalWatchEntries,
} from "@/modules/goal-watch/repository";
import {
  createGoalWatchInputSchema,
  evaluateGoalWatchInputSchema,
  goalWatchConfigSchema,
  goalWatchEvaluationAuditSchema,
  type CreateGoalWatchInput,
  type GoalWatchConfig,
  type GoalWatchEvaluationAudit,
  type GoalWatchSignal,
  type GoalWatchState,
} from "@/modules/goal-watch/schemas";
import { assertTenantAccess } from "@/modules/tenants";

const goalWatchWriteRoles: Role[] = [
  "owner",
  "administrator",
  "manager",
  "collaborator",
];
const systemActorPattern = /^system_[A-Za-z0-9_:-]{1,151}$/;
const defaultSystemActorId = "system_goal_watch";

const signalLabels: Record<GoalWatchSignal, string> = {
  contacts: "Contacts actifs",
  opportunities: "Opportunités ouvertes",
  pipeline_value_cents: "Valeur du pipeline",
  members: "Membres",
  active_workflows: "Workflows actifs",
  websites: "Sites",
  published_websites: "Sites publiés",
  connectors: "Connecteurs",
  api_assets: "Actifs API",
};

export async function createGoalWatch(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: CreateGoalWatchInput,
) {
  const parsed = createGoalWatchInputSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(
      transaction,
      userId,
      tenantId,
      goalWatchWriteRoles,
    );
    const thread = await findConversationThreadRow(
      transaction,
      tenantId,
      parsed.threadId,
    );
    if (!thread) {
      throw new GoalWatchError(
        "goal_watch_thread_not_found",
        "La conversation liée à cet objectif est introuvable.",
      );
    }
    if (thread.status === "archived") {
      throw new GoalWatchError(
        "goal_watch_thread_unavailable",
        "Une conversation archivée ne peut pas recevoir un objectif permanent.",
      );
    }

    const now = nowIso();
    const goalId = id("goal_watch");
    const entryId = id("brain_entry");
    const config = goalWatchConfigSchema.parse({
      schemaVersion: 1,
      threadId: parsed.threadId,
      signal: parsed.signal,
      operator: parsed.operator,
      target: parsed.target,
      cadenceMinutes: parsed.cadenceMinutes,
    });

    await insertBusinessBrainEntry(transaction, {
      id: entryId,
      tenantId,
      entryKey: goalId,
      domain: "objectives",
      title: parsed.title,
      summary: goalSummary(config),
      details: JSON.stringify(config),
      sourceType: "manual",
      sourceRef: GOAL_WATCH_SOURCE_REF,
      confidence: 100,
      version: 1,
      actorId: userId,
      now,
    });
    await insertBusinessBrainEvidence(transaction, {
      id: id("brain_evidence"),
      tenantId,
      entryId,
      evidenceType: "system_record",
      sourceRef: goalId,
      summary: "Objectif permanent créé depuis une conversation TRADIKOM ONE.",
      actorId: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "goal_watch.created",
      targetType: "goal_watch",
      targetId: goalId,
      metadata: {
        signal: config.signal,
        operator: config.operator,
        cadenceMinutes: config.cadenceMinutes,
        threadId: config.threadId,
      },
    });

    return mapGoalWatch(entryId, goalId, tenantId, parsed.title, config, null);
  });
}

export async function getGoalWatch(
  db: DbClient,
  userId: string,
  tenantId: string,
  goalId: string,
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId);
    const entry = await findActiveGoalWatchEntry(transaction, tenantId, goalId);
    if (!entry) {
      throw new GoalWatchError(
        "goal_watch_not_found",
        "Objectif permanent introuvable.",
      );
    }
    const config = parseGoalConfig(entry);
    const latest = await readLatestEvaluation(transaction, tenantId, goalId);
    return mapGoalWatch(
      entry.id,
      entry.entry_key,
      entry.tenant_id,
      entry.title,
      config,
      latest,
    );
  });
}

export async function evaluateGoalWatch(
  db: DbClient,
  systemActorId: string,
  input: {
    tenantId: string;
    goalId: string;
    evaluationKey: string;
    observedAt: string;
  },
) {
  if (!systemActorPattern.test(systemActorId)) {
    throw new GoalWatchError(
      "goal_watch_system_actor_invalid",
      "Identité système de surveillance invalide.",
    );
  }
  const parsed = evaluateGoalWatchInputSchema.parse(input);

  const snapshot = await withSystemDbTransaction(db, async (transaction) => {
    const entry = await findActiveGoalWatchEntry(
      transaction,
      parsed.tenantId,
      parsed.goalId,
    );
    if (!entry) {
      throw new GoalWatchError(
        "goal_watch_not_found",
        "Objectif permanent introuvable.",
      );
    }
    const config = parseGoalConfig(entry);
    const thread = await findConversationThreadRow(
      transaction,
      parsed.tenantId,
      config.threadId,
    );
    if (!thread) {
      throw new GoalWatchError(
        "goal_watch_thread_not_found",
        "La conversation liée à cet objectif est introuvable.",
      );
    }
    if (thread.status === "archived") {
      throw new GoalWatchError(
        "goal_watch_thread_unavailable",
        "La conversation liée à cet objectif est archivée.",
      );
    }
    const previous = await readLatestEvaluation(
      transaction,
      parsed.tenantId,
      parsed.goalId,
    );
    if (previous?.evaluationKey === parsed.evaluationKey) {
      return { entry, config, previous, replay: true as const };
    }

    const signals = await getBusinessBrainSignals(transaction, parsed.tenantId);
    if (!signals) {
      throw new GoalWatchError(
        "goal_watch_state_corrupted",
        "Les signaux métier de l'objectif ne sont pas disponibles.",
      );
    }
    const value = signalValue(signals, config.signal);
    const state = evaluateState(config, value);
    return {
      entry,
      config,
      previous,
      value,
      state,
      replay: false as const,
    };
  });

  if (snapshot.replay) {
    return {
      tenantId: parsed.tenantId,
      goalId: parsed.goalId,
      evaluationKey: parsed.evaluationKey,
      observedAt: snapshot.previous.observedAt,
      state: snapshot.previous.state,
      reported: snapshot.previous.reported,
      reportMessageId: snapshot.previous.reportMessageId,
      idempotentReplay: true,
    };
  }

  const shouldReport =
    !snapshot.previous || snapshot.previous.state !== snapshot.state;
  const report = shouldReport
    ? await reportGoalWatchState(db, systemActorId, {
        entry: snapshot.entry,
        config: snapshot.config,
        previous: snapshot.previous,
        state: snapshot.state,
        value: snapshot.value,
        observedAt: parsed.observedAt,
      })
    : null;

  return withSystemDbTransaction(db, async (transaction) => {
    const latestNow = await readLatestEvaluation(
      transaction,
      parsed.tenantId,
      parsed.goalId,
    );
    if (latestNow?.evaluationKey === parsed.evaluationKey) {
      return {
        tenantId: parsed.tenantId,
        goalId: parsed.goalId,
        evaluationKey: parsed.evaluationKey,
        observedAt: latestNow.observedAt,
        state: latestNow.state,
        reported: latestNow.reported,
        reportMessageId: latestNow.reportMessageId,
        idempotentReplay: true,
      };
    }
    if (
      latestNow &&
      Date.parse(latestNow.observedAt) > Date.parse(parsed.observedAt)
    ) {
      throw new GoalWatchError(
        "goal_watch_evaluation_conflict",
        "Une évaluation plus récente existe déjà pour cet objectif.",
      );
    }

    const auditMetadata: GoalWatchEvaluationAudit = {
      schemaVersion: 1,
      signal: snapshot.config.signal,
      state: snapshot.state,
      evaluationKey: parsed.evaluationKey,
      observedAt: parsed.observedAt,
      reported: shouldReport,
      reportMessageId: report?.messageId ?? null,
    };
    await recordAuditLog(transaction, {
      tenantId: parsed.tenantId,
      actorId: systemActorId,
      action: "goal_watch.evaluated",
      targetType: "goal_watch",
      targetId: parsed.goalId,
      metadata: auditMetadata,
    });

    return {
      tenantId: parsed.tenantId,
      goalId: parsed.goalId,
      evaluationKey: parsed.evaluationKey,
      observedAt: parsed.observedAt,
      state: snapshot.state,
      reported: shouldReport,
      reportMessageId: report?.messageId ?? null,
      idempotentReplay: false,
      reportIdempotentReplay: report?.idempotentReplay ?? false,
    };
  });
}

export async function runDueGoalWatches(
  db: DbClient,
  options: { now?: Date; limit?: number } = {},
) {
  const now = options.now ?? new Date();
  const limit = boundedLimit(options.limit);
  const entries = await withSystemDbTransaction(db, (transaction) =>
    listActiveGoalWatchEntries(transaction, limit),
  );

  let evaluated = 0;
  let reported = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      const config = parseGoalConfig(entry);
      const latest = await withSystemDbTransaction(db, (transaction) =>
        readLatestEvaluation(transaction, entry.tenant_id, entry.entry_key),
      );
      if (!isDue(config, latest, now)) continue;

      const result = await evaluateGoalWatch(db, defaultSystemActorId, {
        tenantId: entry.tenant_id,
        goalId: entry.entry_key,
        evaluationKey: scheduledEvaluationKey(entry.entry_key, config, now),
        observedAt: now.toISOString(),
      });
      if (!result.idempotentReplay) evaluated += 1;
      if (result.reported && !result.idempotentReplay) reported += 1;
    } catch {
      failed += 1;
    }
  }

  return { evaluated, reported, failed };
}

async function reportGoalWatchState(
  db: DbClient,
  systemActorId: string,
  input: {
    entry: BusinessBrainEntryRow;
    config: GoalWatchConfig;
    previous: GoalWatchEvaluationAudit | null;
    state: GoalWatchState;
    value: number;
    observedAt: string;
  },
) {
  const tenantDigest = digest(`goal-watch-identity:${input.entry.tenant_id}`, 32);
  const transitionDigest = digest(
    [
      input.entry.entry_key,
      input.previous?.evaluationKey ?? "initial",
      input.previous?.state ?? "none",
      input.state,
    ].join(":"),
    48,
  );
  const identityId = `identity_goal_watch_${tenantDigest}`;
  const participantId = `participant_goal_watch_${tenantDigest}`;
  const externalMessageId = `goal-watch-report:${transitionDigest}`;

  return ingestSystemConversationMessage(db, systemActorId, {
    tenantId: input.entry.tenant_id,
    threadId: input.config.threadId,
    channelIdentity: {
      id: identityId,
      tenantId: input.entry.tenant_id,
      participantId,
      channelKind: "web",
      adapterKey: "goal-watch",
      externalSubjectId: `goal-watch:${tenantDigest}`,
      displayName: "Suivi d’objectif",
      role: "system",
      state: "active",
      createdAt: input.observedAt,
      updatedAt: input.observedAt,
    },
    externalMessageId,
    idempotencyKey: `goal-watch:report:${transitionDigest}`,
    correlationId: `goal-watch:${transitionDigest}`,
    causationId: input.entry.entry_key,
    routeTrace: [
      {
        adapterKey: "goal-watch",
        channelIdentityId: identityId,
        externalMessageId,
      },
    ],
    text: reportText(input.entry.title, input.config, input.state, input.value),
    attachments: [],
    occurredAt: input.observedAt,
  });
}

function parseGoalConfig(entry: BusinessBrainEntryRow) {
  try {
    return goalWatchConfigSchema.parse(JSON.parse(entry.details));
  } catch {
    throw new GoalWatchError(
      "goal_watch_state_corrupted",
      "La configuration de cet objectif permanent est invalide.",
    );
  }
}

async function readLatestEvaluation(
  db: DbClient,
  tenantId: string,
  goalId: string,
): Promise<GoalWatchEvaluationAudit | null> {
  const row = await findLatestGoalWatchEvaluationAudit(db, tenantId, goalId);
  if (!row) return null;
  try {
    return goalWatchEvaluationAuditSchema.parse(JSON.parse(row.safe_metadata));
  } catch {
    throw new GoalWatchError(
      "goal_watch_state_corrupted",
      "La dernière preuve de surveillance est invalide.",
    );
  }
}

function signalValue(signals: BusinessBrainSignalRow, signal: GoalWatchSignal) {
  const raw: Record<GoalWatchSignal, number | string> = {
    contacts: signals.contact_count,
    opportunities: signals.opportunity_count,
    pipeline_value_cents: signals.pipeline_value_cents,
    members: signals.member_count,
    active_workflows: signals.workflow_count,
    websites: signals.website_count,
    published_websites: signals.published_website_count,
    connectors: signals.connector_count,
    api_assets: signals.api_asset_count,
  };
  const value = Number(raw[signal]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new GoalWatchError(
      "goal_watch_state_corrupted",
      "La valeur observée pour cet objectif est invalide.",
    );
  }
  return value;
}

function evaluateState(config: GoalWatchConfig, value: number): GoalWatchState {
  const met =
    config.operator === "gte" ? value >= config.target : value <= config.target;
  return met ? "met" : "pending";
}

function isDue(
  config: GoalWatchConfig,
  latest: GoalWatchEvaluationAudit | null,
  now: Date,
) {
  if (!latest) return true;
  const last = Date.parse(latest.observedAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= config.cadenceMinutes * 60_000;
}

function scheduledEvaluationKey(
  goalId: string,
  config: GoalWatchConfig,
  now: Date,
) {
  const slot = Math.floor(
    now.getTime() / (config.cadenceMinutes * 60_000),
  );
  return `goal-watch:scheduled:${digest(`${goalId}:${slot}`, 48)}`;
}

function goalSummary(config: GoalWatchConfig) {
  return `Surveiller ${signalLabels[config.signal].toLowerCase()} jusqu’à ${operatorLabel(
    config.operator,
  )} ${formatValue(config.signal, config.target)}.`;
}

function reportText(
  title: string,
  config: GoalWatchConfig,
  state: GoalWatchState,
  value: number,
) {
  const status =
    state === "met" ? "Objectif atteint." : "Objectif en surveillance.";
  return [
    `Suivi d’objectif — ${title}`,
    status,
    `${signalLabels[config.signal]} : ${formatValue(config.signal, value)} ; cible : ${operatorLabel(
      config.operator,
    )} ${formatValue(config.signal, config.target)}.`,
  ].join("\n");
}

function operatorLabel(operator: GoalWatchConfig["operator"]) {
  return operator === "gte" ? "au moins" : "au plus";
}

function formatValue(signal: GoalWatchSignal, value: number) {
  if (signal === "pipeline_value_cents") {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
    }).format(value / 100);
  }
  return new Intl.NumberFormat("fr-FR").format(value);
}

function digest(value: string, length: number) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function boundedLimit(value?: number) {
  if (!value || !Number.isInteger(value)) return 100;
  return Math.max(1, Math.min(500, value));
}

function mapGoalWatch(
  entryId: string,
  goalId: string,
  tenantId: string,
  title: string,
  config: GoalWatchConfig,
  latest: GoalWatchEvaluationAudit | null,
) {
  return {
    entryId,
    goalId,
    tenantId,
    title,
    threadId: config.threadId,
    signal: config.signal,
    operator: config.operator,
    target: config.target,
    cadenceMinutes: config.cadenceMinutes,
    latestEvaluation: latest ?? undefined,
  };
}
