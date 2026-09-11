import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
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
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

type TenantContext = {
  db: TestDb;
  userId: string;
  tenantId: string;
};

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
