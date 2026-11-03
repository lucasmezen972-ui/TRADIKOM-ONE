import { createHash } from "node:crypto";
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
import {
  findAccessibleConversationThreadRow,
  lockConversationThreadRow,
} from "@/modules/conversation-hub/repository";
import { ingestSystemConversationMessage } from "@/modules/conversation-hub/service";
import { GoalWatchError } from "@/modules/goal-watch/errors";
import {
  GOAL_WATCH_SOURCE_REF,
  findActiveGoalWatchEntry,
  findGoalWatchEvaluationAuditsByKey,
  findLatestGoalWatchEvaluationAudit,
  findGoalWatchControl,
  insertGoalWatchControl,
  listGoalWatchEntriesForThread,
  listDueGoalWatchEntries,
  type GoalWatchControlRow,
} from "@/modules/goal-watch/repository";
import {
  createGoalWatchInputSchema,
  changeGoalWatchInputSchema,
  type ChangeGoalWatchInput,
  evaluateGoalWatchInputSchema,
  goalWatchConfigSchema,
  goalWatchEvaluationAuditSchema,
  type CreateGoalWatchInput,
  type GoalWatchConfig,
  type GoalWatchEvaluationAudit,
  type GoalWatchSignal,
  type GoalWatchState,
} from "@/modules/goal-watch/schemas";
import { withGoalWatchActorTransaction, withGoalWatchEvaluationTransaction } from "@/modules/goal-watch/transactions";
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
  return withGoalWatchActorTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(
      transaction,
      userId,
      tenantId,
      goalWatchWriteRoles,
    );
    const thread = await findAccessibleConversationThreadRow(
      transaction,
      tenantId,
      userId,
      parsed.threadId,
    );
    if (!thread) {
      throw new GoalWatchError(
        "goal_watch_thread_not_found",
        "La conversation liée à cet objectif est introuvable.",
      );
    }

    const now = nowIso();
    const goalId = `goal_watch_${digest(`${tenantId}:${userId}:${parsed.idempotencyKey}`, 48)}`;
    const entryId = `brain_entry_${digest(goalId, 48)}`;
    const config = goalWatchConfigSchema.parse({
      schemaVersion: 1,
      threadId: parsed.threadId,
      signal: parsed.signal,
      operator: parsed.operator,
      target: parsed.target,
      cadenceMinutes: parsed.cadenceMinutes,
    });

    if ((transaction as { __runtime?: string }).__runtime === "postgres") {
      await transaction.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [goalId]);
    }
    const existing = await findActiveGoalWatchEntry(transaction, tenantId, goalId, true);
    const lockedThread = await lockConversationThreadRow(transaction, tenantId, parsed.threadId);
    if (!lockedThread || lockedThread.status === "archived") {
      throw new GoalWatchError(
        "goal_watch_thread_unavailable",
        "Une conversation archivée ne peut pas recevoir un objectif permanent.",
      );
    }

    if (existing) {
      if (existing.title !== parsed.title || JSON.stringify(parseGoalConfig(existing)) !== JSON.stringify(config)) {
        throw new GoalWatchError("goal_watch_version_conflict", "Cette demande de création a déjà été utilisée avec un autre objectif.");
      }
      return mapGoalWatch(existing.id, goalId, tenantId, existing.title, config,
        await readLatestEvaluation(transaction, tenantId, goalId),
        await findGoalWatchControl(transaction, tenantId, goalId));
    }

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
    await insertGoalWatchControl(transaction, {
      entryId, tenantId, goalId, threadId: config.threadId, actorId: userId, now,
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
        consentVersion: 1,
        consentConfirmed: true,
      },
    });

    return mapGoalWatch(entryId, goalId, tenantId, parsed.title, config, null,
      await findGoalWatchControl(transaction, tenantId, goalId));
  });
}

export async function getGoalWatch(
  db: DbClient,
  userId: string,
  tenantId: string,
  goalId: string,
) {
  return withGoalWatchActorTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId);
    const entry = await findActiveGoalWatchEntry(transaction, tenantId, goalId);
    if (!entry) {
      throw new GoalWatchError(
        "goal_watch_not_found",
        "Objectif permanent introuvable.",
      );
    }
    const config = parseGoalConfig(entry);
    const thread = await findAccessibleConversationThreadRow(
      transaction,
      tenantId,
      userId,
      config.threadId,
    );
    if (!thread) {
      throw new GoalWatchError(
        "goal_watch_not_found",
        "Objectif permanent introuvable.",
      );
    }
    const latest = await readLatestEvaluation(transaction, tenantId, goalId);
    return mapGoalWatch(
      entry.id,
      entry.entry_key,
      entry.tenant_id,
      entry.title,
      config,
      latest,
      await findGoalWatchControl(transaction, tenantId, goalId),
    );
  });
}

export async function listGoalWatchesForThread(
  db: DbClient, userId: string, tenantId: string, threadId: string,
) {
  return withGoalWatchActorTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId);
    if (!await findAccessibleConversationThreadRow(transaction, tenantId, userId, threadId)) {
      throw new GoalWatchError("goal_watch_thread_not_found", "Conversation introuvable.");
    }
    const entries = await listGoalWatchEntriesForThread(transaction, tenantId, threadId);
    const result = [];
    for (const entry of entries) {
      const config = parseGoalConfig(entry);
      result.push(mapGoalWatch(entry.id, entry.entry_key, tenantId, entry.title, config,
        await readLatestEvaluation(transaction, tenantId, entry.entry_key),
        await findGoalWatchControl(transaction, tenantId, entry.entry_key)));
    }
    return result;
  });
}

export async function changeGoalWatch(
  db: DbClient, userId: string, tenantId: string, input: ChangeGoalWatchInput,
) {
  const parsed = changeGoalWatchInputSchema.parse(input);
  return withGoalWatchActorTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, goalWatchWriteRoles);
    // Same lock order as evaluation: entry, control, thread.
    const entry = await findActiveGoalWatchEntry(transaction, tenantId, parsed.goalId, true);
    if (!entry) throw new GoalWatchError("goal_watch_not_found", "Objectif introuvable.");
    const config = parseGoalConfig(entry);
    const control = await findGoalWatchControl(transaction, tenantId, parsed.goalId, true);
    if (!await findAccessibleConversationThreadRow(transaction, tenantId, userId, config.threadId)) {
      throw new GoalWatchError("goal_watch_not_found", "Objectif introuvable.");
    }
    const thread = await lockConversationThreadRow(transaction, tenantId, config.threadId);
    if (parsed.action === "resume" && (!thread || thread.status === "archived")) {
      throw new GoalWatchError("goal_watch_thread_unavailable", "Le suivi exige une conversation active.");
    }
    if ((control?.version ?? 0) !== parsed.expectedVersion) {
      throw new GoalWatchError("goal_watch_version_conflict", "Cet objectif a changé. Actualisez la conversation.");
    }
    const nextState = { pause: "paused", resume: "active", stop: "stopped" }[parsed.action];
    if (control?.state === nextState) return { goalId: parsed.goalId, threadId: config.threadId, state: control.state, version: control.version };
    if (control?.state === "stopped" || (!control && parsed.action !== "resume")) {
      throw new GoalWatchError("goal_watch_transition_invalid", "Un suivi arrêté ne peut pas reprendre. Créez un nouvel objectif.");
    }
    const now = nowIso();
    if (!control) {
      await insertGoalWatchControl(transaction, { entryId: entry.id, tenantId, goalId: parsed.goalId,
        threadId: config.threadId, actorId: userId, now });
    } else {
      await transaction.query(`update goal_watch_controls set state = $3, version = version + 1,
        updated_by = $4, updated_at = $5, consented_by = $6, consented_at = $7,
        next_due_at = case when $3 = 'active' then '1970-01-01T00:00:00Z'::timestamptz else next_due_at end
        where tenant_id = $1 and goal_id = $2`,
      [tenantId, parsed.goalId, nextState, userId, now,
        parsed.action === "resume" ? userId : control.consented_by,
        parsed.action === "resume" ? now : control.consented_at]);
    }
    const version = (control?.version ?? 0) + 1;
    await recordAuditLog(transaction, { tenantId, actorId: userId,
      action: !control ? "goal_watch.consented" : `goal_watch.${nextState === "active" ? "resumed" : nextState}`,
      targetType: "goal_watch", targetId: parsed.goalId,
      metadata: { state: nextState, version, consentConfirmed: parsed.action === "resume" } });
    return { goalId: parsed.goalId, threadId: config.threadId, state: nextState, version };
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

  return withGoalWatchEvaluationTransaction(db, async (transaction) => {
    // Serialize every evaluation for this goal until both its report and audit
    // commit. All reads below use the same transaction and connection.
    const entry = await findActiveGoalWatchEntry(
      transaction,
      parsed.tenantId,
      parsed.goalId,
      true,
    );
    if (!entry) {
      throw new GoalWatchError(
        "goal_watch_not_found",
        "Objectif permanent introuvable.",
      );
    }
    const config = parseGoalConfig(entry);
    const control = await findGoalWatchControl(transaction, parsed.tenantId, parsed.goalId, true);
    if (!control) throw new GoalWatchError("goal_watch_consent_required", "Confirmez le suivi dans la conversation avant toute évaluation.");
    if (control.state !== "active") throw new GoalWatchError("goal_watch_inactive", "Le suivi de cet objectif est suspendu ou arrêté.");
    await assertTenantAccess(transaction, control.consented_by, parsed.tenantId, goalWatchWriteRoles);
    if (!await findAccessibleConversationThreadRow(transaction, parsed.tenantId, control.consented_by, config.threadId)) {
      throw new GoalWatchError("goal_watch_consent_required", "L'autorisation de suivi n'est plus valide pour cette conversation.");
    }
    const thread = await lockConversationThreadRow(
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
    const replay = await readEvaluationByKey(
      transaction,
      parsed.tenantId,
      parsed.goalId,
      parsed.evaluationKey,
    );
    if (replay) {
      if (Date.parse(replay.observedAt) !== Date.parse(parsed.observedAt)) {
        throw new GoalWatchError(
          "goal_watch_evaluation_conflict",
          "Cette clé de surveillance appartient à une autre observation.",
        );
      }
      return {
        tenantId: parsed.tenantId,
        goalId: parsed.goalId,
        evaluationKey: parsed.evaluationKey,
        observedAt: replay.observedAt,
        state: replay.state,
        reported: replay.reported,
        reportMessageId: replay.reportMessageId,
        idempotentReplay: true,
      };
    }
    const previous = await readLatestEvaluation(
      transaction,
      parsed.tenantId,
      parsed.goalId,
    );
    if (
      previous &&
      Date.parse(previous.observedAt) >= Date.parse(parsed.observedAt)
    ) {
      throw new GoalWatchError(
        "goal_watch_evaluation_conflict",
        "Une évaluation de même date ou plus récente existe déjà pour cet objectif.",
      );
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
    const shouldReport = !previous || previous.state !== state;
    const report = shouldReport
      ? await reportGoalWatchState(transaction, systemActorId, {
          entry,
          config,
          previous,
          state,
          value,
          observedAt: parsed.observedAt,
        })
      : null;

    const auditMetadata: GoalWatchEvaluationAudit = {
      schemaVersion: 1,
      signal: config.signal,
      state,
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

    await transaction.query(`update goal_watch_controls set next_due_at = $3::timestamptz
      where tenant_id = $1 and goal_id = $2`, [parsed.tenantId, parsed.goalId,
      new Date(Date.parse(parsed.observedAt) + config.cadenceMinutes * 60_000).toISOString()]);

    return {
      tenantId: parsed.tenantId,
      goalId: parsed.goalId,
      evaluationKey: parsed.evaluationKey,
      observedAt: parsed.observedAt,
      state,
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
  let evaluated = 0;
  let reported = 0;
  let failed = 0;

  const entries = await withGoalWatchEvaluationTransaction(db, (transaction) =>
    listDueGoalWatchEntries(transaction, limit, now.toISOString()),
  );
  for (const entry of entries) {
    try {
      const config = parseGoalConfig(entry);
      const control = await withGoalWatchEvaluationTransaction(db, (transaction) =>
        findGoalWatchControl(transaction, entry.tenant_id, entry.entry_key));
      const result = await evaluateGoalWatch(db, defaultSystemActorId, {
        tenantId: entry.tenant_id, goalId: entry.entry_key,
        evaluationKey: scheduledEvaluationKey(entry.entry_key, config, now, control?.version ?? 0),
        observedAt: now.toISOString(),
      });
      if (!result.idempotentReplay) evaluated += 1;
      if (result.reported && !result.idempotentReplay) reported += 1;
    } catch {
      failed += 1;
      // Back off corrupt or inaccessible goals so one tenant cannot occupy every batch.
      // Never overwrite the lifecycle or a later successful schedule.
      await withGoalWatchEvaluationTransaction(db, async (transaction) => {
        await transaction.query(`update goal_watch_controls set next_due_at = $3::timestamptz
          where tenant_id = $1 and goal_id = $2 and state = 'active' and next_due_at <= $4::timestamptz`,
        [entry.tenant_id, entry.entry_key, new Date(now.getTime() + 60 * 60_000).toISOString(), now.toISOString()]);
      });
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
  try {
    const row = await findLatestGoalWatchEvaluationAudit(db, tenantId, goalId);
    if (!row) return null;
    return goalWatchEvaluationAuditSchema.parse(JSON.parse(row.safe_metadata));
  } catch {
    throw new GoalWatchError(
      "goal_watch_state_corrupted",
      "La dernière preuve de surveillance est invalide.",
    );
  }
}

async function readEvaluationByKey(
  db: DbClient,
  tenantId: string,
  goalId: string,
  evaluationKey: string,
): Promise<GoalWatchEvaluationAudit | null> {
  try {
    const rows = await findGoalWatchEvaluationAuditsByKey(
      db, tenantId, goalId, evaluationKey,
    );
    if (rows.length > 1) throw new Error("Duplicate Goal Watch evaluation key.");
    if (!rows[0]) return null;
    return goalWatchEvaluationAuditSchema.parse(JSON.parse(rows[0].safe_metadata));
  } catch {
    throw new GoalWatchError(
      "goal_watch_state_corrupted",
      "La preuve de surveillance demandée est invalide.",
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

function scheduledEvaluationKey(
  goalId: string,
  config: GoalWatchConfig,
  now: Date,
  version: number,
) {
  const slot = Math.floor(
    now.getTime() / (config.cadenceMinutes * 60_000),
  );
  return `goal-watch:scheduled:${digest(`${goalId}:${version}:${slot}`, 48)}`;
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
  control: GoalWatchControlRow | null = null,
) {
  return {
    entryId,
    goalId,
    tenantId,
    title,
    threadId: config.threadId,
    signal: config.signal,
    signalLabel: signalLabels[config.signal],
    targetLabel: formatValue(config.signal, config.target),
    operator: config.operator,
    target: config.target,
    cadenceMinutes: config.cadenceMinutes,
    state: (control?.state ?? "consent_required") as GoalWatchControlRow["state"] | "consent_required",
    version: control?.version ?? 0,
    consentedAt: control?.consented_at,
    latestEvaluation: latest ?? undefined,
  };
}
