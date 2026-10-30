import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { pgClientAsSqlClient, pgPoolAsSqlClient, type SqlClient } from "../src/db/client";
import { migrate } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { ingestConversationMessage } from "../src/modules/conversation-hub";
import { createGoalWatch, evaluateGoalWatch } from "../src/modules/goal-watch";

const databaseUrl = process.env.DATABASE_URL;
const describeIfPostgres = databaseUrl ? describe : describe.skip;
const fixtures: Array<{ pool: Pool; userId?: string; tenantId?: string }> = [];
const observedAt = "2026-08-20T13:00:00.000Z";

afterEach(async () => {
  const errors: unknown[] = [];
  for (const fixture of fixtures.splice(0).reverse()) {
    try {
      if (fixture.tenantId) {
        await fixture.pool.query("delete from tenants where id = $1", [fixture.tenantId]);
      }
      if (fixture.userId) {
        await fixture.pool.query("delete from users where id = $1", [fixture.userId]);
      }
    } catch (error) {
      errors.push(error);
    } finally {
      await fixture.pool.end();
    }
  }
  if (errors.length) throw new AggregateError(errors, "Nettoyage Goal Watch PostgreSQL incomplet.");
});

describeIfPostgres("durabilité Goal Watch sur PostgreSQL", () => {
  it("sérialise deux connexions sur la ligne objectif puis rejoue une seule preuve", async () => {
    const { pool, db, tenantId, goalId } = await createFixture();
    const firstConnection = await pool.connect();
    const secondConnection = await pool.connect();
    let waiting: ReturnType<typeof evaluateGoalWatch> | undefined;
    try {
      await beginSystem(firstConnection);
      await beginSystem(secondConnection);
      const firstPid = (await firstConnection.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      const secondPid = (await secondConnection.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      expect(firstPid).not.toBe(secondPid);
      const input = { tenantId, goalId, evaluationKey: "goal-watch:pg:concurrent", observedAt };
      const first = await evaluateGoalWatch(
        pgClientAsSqlClient(firstConnection), "system_goal_watch", input,
      );
      // The first evaluation has returned but its caller-owned transaction still
      // holds the goal lock. A second backend must wait before reading history.
      waiting = evaluateGoalWatch(
        pgClientAsSqlClient(secondConnection), "system_goal_watch", input,
      );
      // Attach a rejection handler immediately while the lock is observed.
      void waiting.catch(() => {});
      const blockedQuery = await waitForGoalLock(firstConnection, firstPid, secondPid);
      expect(blockedQuery).toContain("business_brain_entries");
      expect(blockedQuery).toMatch(/for update/i);
      await firstConnection.query("commit");
      const replay = await waiting;
      await secondConnection.query("commit");
      expect(first.idempotentReplay).toBe(false);
      expect(replay).toMatchObject({ idempotentReplay: true, reportMessageId: first.reportMessageId });
      expect(await counts(pool, tenantId)).toEqual({ reports: 1, evaluations: 1 });
      await expect(evaluateGoalWatch(db, "system_goal_watch", {
        ...input, evaluationKey: "goal-watch:pg:equal-time",
      })).rejects.toMatchObject({ code: "goal_watch_evaluation_conflict" });
      expect(await counts(pool, tenantId)).toEqual({ reports: 1, evaluations: 1 });
    } finally {
      // Releasing the first transaction also lets a failed assertion unblock the
      // second writer, so cleanup never leaves a backend holding a row lock.
      await firstConnection.query("rollback");
      if (waiting) await waiting.catch(() => {});
      await secondConnection.query("rollback");
      firstConnection.release();
      secondConnection.release();
    }
  });

  it("rollback le rapport et ses annexes lorsque l’audit final échoue", async () => {
    const { pool, db, tenantId, goalId } = await createFixture();
    const failingDb: SqlClient = {
      ...db,
      __withTransaction: (context, callback) => db.__withTransaction!(context, (transaction) =>
        callback({
          ...transaction,
          async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
            if (sql.startsWith("insert into audit_logs") && params?.[3] === "goal_watch.evaluated") {
              throw new Error("Goal Watch PostgreSQL audit fixture failure");
            }
            return transaction.query<T>(sql, params);
          },
        }),
      ),
    };
    const input = { tenantId, goalId, evaluationKey: "goal-watch:pg:rollback", observedAt };
    await expect(evaluateGoalWatch(failingDb, "system_goal_watch", input))
      .rejects.toThrow("Goal Watch PostgreSQL audit fixture failure");
    expect(await counts(pool, tenantId)).toEqual({ reports: 0, evaluations: 0 });
    const identities = await pool.query<{ count: number }>(
      `select count(*)::int as count from conversation_channel_identities
       where tenant_id = $1 and adapter_key = 'goal-watch'`, [tenantId],
    );
    expect(identities.rows[0]?.count).toBe(0);
    await expect(evaluateGoalWatch(db, "system_goal_watch", input))
      .resolves.toMatchObject({ idempotentReplay: false, reported: true });
    expect(await counts(pool, tenantId)).toEqual({ reports: 1, evaluations: 1 });
  });
});

async function beginSystem(client: PoolClient) {
  await client.query("begin");
  await client.query("select set_config('app.system_access', 'true', true)");
}

async function waitForGoalLock(observer: PoolClient, firstPid: number, secondPid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    // PostgreSQL caches activity snapshots until the transaction ends.
    await observer.query("select pg_stat_clear_snapshot()");
    const result = await observer.query<{ blockers: number[]; query: string }>(
      `select pg_blocking_pids(pid) as blockers, query
       from pg_stat_activity where pid = $1`, [secondPid],
    );
    const activity = result.rows[0];
    if (activity?.blockers.includes(firstPid)) return activity.query;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("La seconde connexion n’attend pas le verrou de l’objectif.");
}

async function counts(pool: Pool, tenantId: string) {
  const result = await pool.query<{ reports: number; evaluations: number }>(
    `select
       (select count(*)::int from conversation_messages
        where tenant_id = $1 and adapter_key = 'goal-watch') as reports,
       (select count(*)::int from audit_logs
        where tenant_id = $1 and action = 'goal_watch.evaluated') as evaluations`,
    [tenantId],
  );
  return result.rows[0];
}

async function createFixture() {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const fixture: { pool: Pool; userId?: string; tenantId?: string } = { pool };
  fixtures.push(fixture);
  const db = pgPoolAsSqlClient(pool);
  await migrate(db, { enableRls: true });
  const services = createServices(db);
  const unique = randomUUID().replaceAll("-", "");
  const user = await services.registerUser({
    name: "Responsable durabilité", email: `goal-durability-${unique}@example.test`,
    password: "Password!1",
  });
  fixture.userId = user.id;
  const tenant = await services.createTenant(user.id, {
    name: `Organisation Goal Watch ${unique}`, category: "Services",
  });
  fixture.tenantId = tenant.id;
  const ingress = await ingestConversationMessage(db, user.id, {
    tenantId: tenant.id,
    channelIdentity: {
      id: `identity_goal_pg_${unique}`, tenantId: tenant.id,
      participantId: `participant_goal_pg_${unique}`, channelKind: "test",
      adapterKey: "canal-test", externalSubjectId: `goal_pg_${unique}`,
      displayName: "Cliente test", role: "customer", state: "active",
      createdAt: observedAt, updatedAt: observedAt,
    },
    externalMessageId: `external_goal_pg_${unique}`,
    idempotencyKey: `goal-watch:pg:ingress:${unique}`,
    correlationId: `goal-watch:pg:${unique}`, routeTrace: [],
    text: "Fixture interne sans fournisseur.", attachments: [], occurredAt: observedAt,
  });
  const goal = await createGoalWatch(db, user.id, tenant.id, {
    threadId: ingress.threadId, title: "Vérifier la durabilité",
    signal: "contacts", operator: "gte", target: 1, cadenceMinutes: 60,
  });
  return { pool, db, tenantId: tenant.id, goalId: goal.goalId };
}
