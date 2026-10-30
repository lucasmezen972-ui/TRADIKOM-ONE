import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  getConversationThread,
  ingestConversationMessage,
} from "../src/modules/conversation-hub/service";
import {
  createGoalWatch,
  evaluateGoalWatch,
  getGoalWatch,
} from "../src/modules/goal-watch";
import { runMaintenance } from "../src/modules/maintenance";

const opened: Array<{ close: () => Promise<void> }> = [];
const threadTimestamp = "2026-08-20T12:00:00.000Z";
const firstEvaluationAt = "2026-08-20T13:00:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("Goal and Watch Engine", () => {
  it("crée un objectif permanent, le surveille de façon idempotente et le rapporte dans le même fil", async () => {
    const context = await createTenantContext("goal-watch-owner@example.com");
    const threadId = await createConversation(context);
    const goal = await createGoalWatch(
      context.db,
      context.userId,
      context.tenantId,
      {
        threadId,
        title: "Atteindre un premier contact actif",
        signal: "contacts",
        operator: "gte",
        target: 1,
        cadenceMinutes: 60,
      },
    );

    const first = await evaluateGoalWatch(context.db, "system_goal_watch", {
      tenantId: context.tenantId,
      goalId: goal.goalId,
      evaluationKey: "goal-watch:test:first",
      observedAt: firstEvaluationAt,
    });
    const replay = await evaluateGoalWatch(context.db, "system_goal_watch", {
      tenantId: context.tenantId,
      goalId: goal.goalId,
      evaluationKey: "goal-watch:test:first",
      observedAt: firstEvaluationAt,
    });

    expect(first).toMatchObject({
      state: "pending",
      reported: true,
      idempotentReplay: false,
    });
    expect(replay).toMatchObject({
      state: "pending",
      reported: true,
      idempotentReplay: true,
      reportMessageId: first.reportMessageId,
    });

    const thread = await getConversationThread(
      context.db,
      context.userId,
      context.tenantId,
      threadId,
    );
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1]).toMatchObject({
      text: expect.stringContaining("Objectif en surveillance"),
      provenance: {
        adapterKey: "goal-watch",
        idempotencyKey: expect.stringMatching(/^goal-watch:report:/),
      },
    });

    const storedGoal = await getGoalWatch(
      context.db,
      context.userId,
      context.tenantId,
      goal.goalId,
    );
    expect(storedGoal).toMatchObject({
      goalId: goal.goalId,
      threadId,
      signal: "contacts",
      target: 1,
      latestEvaluation: {
        state: "pending",
        evaluationKey: "goal-watch:test:first",
        reported: true,
      },
    });

    const versions = await context.db.query<{ count: number | string }>(
      `select count(*) as count
       from business_brain_entries
       where tenant_id = $1 and entry_key = $2`,
      [context.tenantId, goal.goalId],
    );
    expect(Number(versions.rows[0]?.count)).toBe(1);

    const audits = await context.db.query<{
      action: string;
      safe_metadata: string;
    }>(
      `select action, safe_metadata
       from audit_logs
       where tenant_id = $1 and target_type = 'goal_watch'
       order by created_at asc`,
      [context.tenantId],
    );
    expect(audits.rows.map((row) => row.action)).toEqual([
      "goal_watch.created",
      "goal_watch.evaluated",
    ]);
    for (const audit of audits.rows) {
      expect(audit.safe_metadata).not.toContain("Atteindre un premier contact actif");
      expect(audit.safe_metadata).not.toContain("Contenu client confidentiel");
      expect(audit.safe_metadata).not.toContain("visitor_goal_watch");
    }
  });

  it("rapporte uniquement les changements d’état et garde l’isolation tenant", async () => {
    const ownerA = await createTenantContext("goal-watch-a@example.com");
    const ownerB = await createSecondUserAndTenant(
      ownerA.db,
      "goal-watch-b@example.com",
    );
    const threadId = await createConversation(ownerA);
    const goal = await createGoalWatch(
      ownerA.db,
      ownerA.userId,
      ownerA.tenantId,
      {
        threadId,
        title: "Obtenir au moins un contact",
        signal: "contacts",
        operator: "gte",
        target: 1,
        cadenceMinutes: 60,
      },
    );

    await evaluateGoalWatch(ownerA.db, "system_goal_watch", {
      tenantId: ownerA.tenantId,
      goalId: goal.goalId,
      evaluationKey: "goal-watch:test:pending",
      observedAt: firstEvaluationAt,
    });
    await insertContact(ownerA.db, ownerA.tenantId);
    const met = await evaluateGoalWatch(ownerA.db, "system_goal_watch", {
      tenantId: ownerA.tenantId,
      goalId: goal.goalId,
      evaluationKey: "goal-watch:test:met",
      observedAt: "2026-08-20T14:00:00.000Z",
    });
    const unchanged = await evaluateGoalWatch(ownerA.db, "system_goal_watch", {
      tenantId: ownerA.tenantId,
      goalId: goal.goalId,
      evaluationKey: "goal-watch:test:met-again",
      observedAt: "2026-08-20T15:00:00.000Z",
    });

    expect(met).toMatchObject({ state: "met", reported: true });
    expect(unchanged).toMatchObject({ state: "met", reported: false });

    const thread = await getConversationThread(
      ownerA.db,
      ownerA.userId,
      ownerA.tenantId,
      threadId,
    );
    expect(
      thread.messages.filter(
        (message) => message.provenance.adapterKey === "goal-watch",
      ),
    ).toHaveLength(2);
    expect(thread.messages.at(-1)?.text).toContain("Objectif atteint");

    await expect(
      getGoalWatch(ownerA.db, ownerB.userId, ownerB.tenantId, goal.goalId),
    ).rejects.toMatchObject({ code: "goal_watch_not_found" });
  });

  it("branche les objectifs dus sur la maintenance planifiée sans rapport en doublon", async () => {
    const context = await createTenantContext("goal-watch-maintenance@example.com");
    const threadId = await createConversation(context);
    await createGoalWatch(context.db, context.userId, context.tenantId, {
      threadId,
      title: "Surveiller la base contacts",
      signal: "contacts",
      operator: "gte",
      target: 1,
      cadenceMinutes: 60,
    });

    const now = new Date(firstEvaluationAt);
    const first = await runMaintenance(context.db, { now, batchSize: 50 });
    const second = await runMaintenance(context.db, { now, batchSize: 50 });

    expect(first).toMatchObject({
      goalWatchEvaluations: 1,
      goalWatchReports: 1,
      goalWatchFailures: 0,
    });
    expect(second).toMatchObject({
      goalWatchEvaluations: 0,
      goalWatchReports: 0,
      goalWatchFailures: 0,
    });

    const messages = await context.db.query<{ count: number | string }>(
      `select count(*) as count
       from conversation_messages
       where tenant_id = $1 and adapter_key = 'goal-watch'`,
      [context.tenantId],
    );
    expect(Number(messages.rows[0]?.count)).toBe(1);
  });
  it("rejoue une clé historique exacte sans modifier la dernière observation", async () => {
    const { context, threadId, goal } = await createDurabilityFixture("history");
    const first = await evaluateGoalWatch(context.db, "system_goal_watch", {
      tenantId: context.tenantId, goalId: goal.goalId,
      evaluationKey: "goal-watch:history:first", observedAt: firstEvaluationAt,
    });
    await insertContact(context.db, context.tenantId);
    const second = await evaluateGoalWatch(context.db, "system_goal_watch", {
      tenantId: context.tenantId, goalId: goal.goalId,
      evaluationKey: "goal-watch:history:second", observedAt: "2026-08-20T14:00:00Z",
    });
    const replay = await evaluateGoalWatch(context.db, "system_goal_watch", {
      tenantId: context.tenantId, goalId: goal.goalId,
      evaluationKey: "goal-watch:history:first", observedAt: firstEvaluationAt,
    });
    expect(replay).toMatchObject({
      state: "pending", idempotentReplay: true, reportMessageId: first.reportMessageId,
    });
    expect(second.state).toBe("met");
    expect(await durabilityCounts(context)).toEqual({ reports: 2, evaluations: 2 });
    expect((await getGoalWatch(context.db, context.userId, context.tenantId, goal.goalId))
      .latestEvaluation?.evaluationKey).toBe("goal-watch:history:second");
    expect((await getConversationThread(context.db, context.userId, context.tenantId, threadId))
      .messages.at(-1)?.id).toBe(second.reportMessageId);

    await expect(evaluateGoalWatch(context.db, "system_goal_watch", {
      tenantId: context.tenantId, goalId: goal.goalId,
      evaluationKey: "goal-watch:history:first", observedAt: "2026-08-20T15:00:00Z",
    })).rejects.toMatchObject({ code: "goal_watch_evaluation_conflict" });
    expect(await durabilityCounts(context)).toEqual({ reports: 2, evaluations: 2 });
  });

  it("refuse les observations antérieures ou égales avant tout rapport", async () => {
    const { context, goal } = await createDurabilityFixture("out-of-order");
    await evaluateGoalWatch(context.db, "system_goal_watch", {
      tenantId: context.tenantId, goalId: goal.goalId,
      evaluationKey: "goal-watch:ordering:latest", observedAt: "2026-08-20T14:00:00Z",
    });
    await insertContact(context.db, context.tenantId);
    for (const [suffix, observedAt] of [
      ["older", firstEvaluationAt],
      ["equal", "2026-08-20T16:00:00+02:00"],
    ]) {
      await expect(evaluateGoalWatch(context.db, "system_goal_watch", {
        tenantId: context.tenantId, goalId: goal.goalId,
        evaluationKey: `goal-watch:ordering:${suffix}`, observedAt,
      })).rejects.toMatchObject({ code: "goal_watch_evaluation_conflict" });
    }
    expect(await durabilityCounts(context)).toEqual({ reports: 1, evaluations: 1 });
  });

  it("garde l’ordre observedAt lorsque les dates d’écriture d’audit divergent", async () => {
    const { context, goal } = await createDurabilityFixture("audit-order");
    await evaluateGoalWatch(context.db, "system_goal_watch", {
      tenantId: context.tenantId, goalId: goal.goalId,
      evaluationKey: "goal-watch:order:first", observedAt: firstEvaluationAt,
    });
    await context.db.query(
      `update audit_logs set created_at = '2099-01-01T00:00:00Z'
       where tenant_id = $1 and action = 'goal_watch.evaluated'`,
      [context.tenantId],
    );
    await evaluateGoalWatch(context.db, "system_goal_watch", {
      tenantId: context.tenantId, goalId: goal.goalId,
      evaluationKey: "goal-watch:order:second", observedAt: "2026-08-20T14:00:00Z",
    });
    expect((await getGoalWatch(context.db, context.userId, context.tenantId, goal.goalId))
      .latestEvaluation?.evaluationKey).toBe("goal-watch:order:second");
  });

  it("annule le rapport et ses écritures annexes si la preuve d’évaluation échoue", async () => {
    const { context, goal, threadId } = await createDurabilityFixture("rollback");
    const failingDb: DbClient & { transaction: TestDb["transaction"] } = {
      query: (sql, params) => context.db.query(sql, params),
      transaction: (callback) => context.db.transaction((transaction) => {
        const query = transaction.query.bind(transaction);
        transaction.query = (sql, params, options) => {
          if (sql.startsWith("insert into audit_logs") && params?.[3] === "goal_watch.evaluated") {
            throw new Error("Goal Watch audit fixture failure");
          }
          return query(sql, params, options);
        };
        return callback(transaction);
      }),
    };
    const input = {
      tenantId: context.tenantId, goalId: goal.goalId,
      evaluationKey: "goal-watch:rollback:first", observedAt: firstEvaluationAt,
    };
    await expect(evaluateGoalWatch(failingDb, "system_goal_watch", input))
      .rejects.toThrow("Goal Watch audit fixture failure");
    expect(await durabilityCounts(context)).toEqual({ reports: 0, evaluations: 0 });
    const thread = await getConversationThread(context.db, context.userId, context.tenantId, threadId);
    expect(thread.messages).toHaveLength(1);
    const identities = await context.db.query<{ count: number }>(
      `select count(*)::int as count from conversation_channel_identities
       where tenant_id = $1 and adapter_key = 'goal-watch'`, [context.tenantId],
    );
    expect(identities.rows[0]?.count).toBe(0);
    await expect(evaluateGoalWatch(context.db, "system_goal_watch", input))
      .resolves.toMatchObject({ idempotentReplay: false, reported: true });
    expect(await durabilityCounts(context)).toEqual({ reports: 1, evaluations: 1 });
  });

  it("sérialise les évaluations concurrentes sur la connexion PGlite", async () => {
    const { context, goal } = await createDurabilityFixture("concurrent");
    const input = {
      tenantId: context.tenantId, goalId: goal.goalId,
      evaluationKey: "goal-watch:concurrent:first", observedAt: firstEvaluationAt,
    };
    const results = await Promise.all([
      evaluateGoalWatch(context.db, "system_goal_watch", input),
      evaluateGoalWatch(context.db, "system_goal_watch", input),
    ]);
    expect(results.map((result) => result.idempotentReplay).sort()).toEqual([false, true]);
    expect(results[0].reportMessageId).toBe(results[1].reportMessageId);
    expect(await durabilityCounts(context)).toEqual({ reports: 1, evaluations: 1 });
  });

  it("refuse aussi un rejeu historique lorsque le fil est archivé", async () => {
    const { context, goal, threadId } = await createDurabilityFixture("archived");
    const input = {
      tenantId: context.tenantId, goalId: goal.goalId,
      evaluationKey: "goal-watch:archived:first", observedAt: firstEvaluationAt,
    };
    await evaluateGoalWatch(context.db, "system_goal_watch", input);
    await context.db.query(
      "update conversation_threads set status = 'archived' where tenant_id = $1 and id = $2",
      [context.tenantId, threadId],
    );
    for (const evaluation of [input, {
      ...input, evaluationKey: "goal-watch:archived:next", observedAt: "2026-08-20T14:00:00Z",
    }]) {
      await expect(evaluateGoalWatch(context.db, "system_goal_watch", evaluation))
        .rejects.toMatchObject({ code: "goal_watch_thread_unavailable" });
    }
    expect(await durabilityCounts(context)).toEqual({ reports: 1, evaluations: 1 });
  });

});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

type TenantContext = {
  db: TestDb;
  userId: string;
  tenantId: string;
};

async function createDurabilityFixture(name: string) {
  const context = await createTenantContext(`goal-watch-${name}@example.test`);
  const threadId = await createConversation(context);
  const goal = await createGoalWatch(context.db, context.userId, context.tenantId, {
    threadId, title: "Objectif de durabilité", signal: "contacts", operator: "gte",
    target: 1, cadenceMinutes: 60,
  });
  return { context, threadId, goal };
}

async function durabilityCounts(context: TenantContext) {
  const result = await context.db.query<{ reports: number; evaluations: number }>(
    `select
       (select count(*)::int from conversation_messages
        where tenant_id = $1 and adapter_key = 'goal-watch') as reports,
       (select count(*)::int from audit_logs
        where tenant_id = $1 and action = 'goal_watch.evaluated') as evaluations`,
    [context.tenantId],
  );
  return result.rows[0];
}

async function createTenantContext(email: string): Promise<TenantContext> {
  const db = await createMemoryDb();
  opened.push(db);
  return createSecondUserAndTenant(db, email);
}

async function createSecondUserAndTenant(db: TestDb, email: string) {
  const services = createServices(db);
  const user = await services.registerUser({
    name: "Responsable Goal Watch",
    email,
    password: "Password!1",
  });
  const tenant = await services.createTenant(user.id, {
    name: `Organisation ${email}`,
    category: "Services",
  });
  return { db, userId: user.id, tenantId: tenant.id };
}

async function createConversation(context: TenantContext) {
  const result = await ingestConversationMessage(
    context.db,
    context.userId,
    {
      tenantId: context.tenantId,
      channelIdentity: {
        id: `identity_goal_watch_${context.tenantId}`,
        tenantId: context.tenantId,
        participantId: `participant_goal_watch_${context.tenantId}`,
        channelKind: "test",
        adapterKey: "canal-test",
        externalSubjectId: "visitor_goal_watch",
        displayName: "Cliente test",
        role: "customer",
        state: "active",
        createdAt: threadTimestamp,
        updatedAt: threadTimestamp,
      },
      externalMessageId: "external_goal_watch_message",
      idempotencyKey: `goal-watch:ingress:${context.tenantId}`,
      correlationId: `goal-watch:correlation:${context.tenantId}`,
      routeTrace: [],
      text: "Contenu client confidentiel",
      attachments: [],
      occurredAt: threadTimestamp,
    },
  );
  return result.threadId;
}

async function insertContact(db: TestDb, tenantId: string) {
  await db.query(
    `insert into contacts (
       id, tenant_id, name, email, phone, status, source, tags,
       assigned_user_id, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
    [
      "contact_goal_watch",
      tenantId,
      "Contact Goal Watch",
      "contact.goal-watch@example.com",
      "+596696000000",
      "active",
      "test",
      "[]",
      null,
      "2026-08-20T13:30:00.000Z",
    ],
  );
}
