import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  configureConversationThreadAccess,
  getConversationThread,
  ingestConversationMessage,
  listConversationThreads,
} from "../src/modules/conversation-hub/service";

const opened: Array<{ close: () => Promise<void> }> = [];
const timestamp = "2026-09-04T20:25:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("autorisations durables des fils canoniques", () => {
  it("applique personal/team/case, reste compatible tenant et rejoue sans doublon", async () => {
    const context = await setup();
    const first = await configureConversationThreadAccess(
      context.db,
      context.ownerId,
      {
        tenantId: context.tenantId,
        threadId: context.threadId,
        visibilityScope: "team",
        grantedUserIds: [context.readerId, context.ownerId],
        idempotencyKey: "thread-access:team:initial",
      },
    );
    const replay = await configureConversationThreadAccess(
      context.db,
      context.ownerId,
      {
        tenantId: context.tenantId,
        threadId: context.threadId,
        visibilityScope: "team",
        grantedUserIds: [context.ownerId, context.readerId],
        idempotencyKey: "thread-access:team:initial",
      },
    );
    expect(first).toMatchObject({
      threadId: context.threadId,
      visibilityScope: "team",
      grantedUserCount: 2,
      idempotentReplay: false,
    });
    expect(replay).toMatchObject({
      configuredAt: first.configuredAt,
      idempotentReplay: true,
    });
    await expect(
      configureConversationThreadAccess(context.db, context.ownerId, {
        tenantId: context.tenantId,
        threadId: context.threadId,
        visibilityScope: "team",
        grantedUserIds: [context.ownerId],
        idempotencyKey: "thread-access:team:initial",
      }),
    ).rejects.toMatchObject({
      code: "conversation_thread_access_idempotency_conflict",
    });

    await expect(
      getConversationThread(
        context.db,
        context.readerId,
        context.tenantId,
        context.threadId,
      ),
    ).resolves.toMatchObject({ visibilityScope: "team" });
    await expect(
      listConversationThreads(
        context.db,
        context.excludedId,
        context.tenantId,
      ),
    ).resolves.toEqual([]);
    await expect(
      getConversationThread(
        context.db,
        context.excludedId,
        context.tenantId,
        context.threadId,
      ),
    ).rejects.toMatchObject({ code: "conversation_thread_not_found" });
    await expect(
      ingestConversationMessage(
        context.db,
        context.excludedId,
        ingressFixture(context.tenantId, context.threadId, "excluded"),
      ),
    ).rejects.toMatchObject({ code: "conversation_thread_not_found" });

    await expect(
      configureConversationThreadAccess(context.db, context.ownerId, {
        tenantId: context.tenantId,
        threadId: context.threadId,
        visibilityScope: "case",
        grantedUserIds: [context.outsideUserId],
        idempotencyKey: "thread-access:case:outside",
      }),
    ).rejects.toMatchObject({
      code: "conversation_thread_access_invalid_grantee",
    });
    const unchanged = await context.db.query<{ scope: string; user_id: string }>(
      `select scope, user_id
       from conversation_thread_access_grants
       where tenant_id = $1 and thread_id = $2
       order by user_id`,
      [context.tenantId, context.threadId],
    );
    expect(unchanged.rows).toEqual([
      { scope: "team", user_id: context.ownerId },
      { scope: "team", user_id: context.readerId },
    ].sort((left, right) => left.user_id.localeCompare(right.user_id)));

    await expect(
      configureConversationThreadAccess(context.db, context.ownerId, {
        tenantId: context.tenantId,
        threadId: context.threadId,
        visibilityScope: "personal",
        grantedUserIds: [context.ownerId, context.readerId],
        idempotencyKey: "thread-access:personal:invalid",
      }),
    ).rejects.toBeDefined();

    await configureConversationThreadAccess(context.db, context.ownerId, {
      tenantId: context.tenantId,
      threadId: context.threadId,
      visibilityScope: "case",
      grantedUserIds: [context.readerId],
      idempotencyKey: "thread-access:case:reader",
    });
    await expect(
      getConversationThread(
        context.db,
        context.readerId,
        context.tenantId,
        context.threadId,
      ),
    ).resolves.toMatchObject({ visibilityScope: "case" });
    await expect(
      getConversationThread(
        context.db,
        context.ownerId,
        context.tenantId,
        context.threadId,
      ),
    ).rejects.toMatchObject({ code: "conversation_thread_not_found" });

    await configureConversationThreadAccess(context.db, context.ownerId, {
      tenantId: context.tenantId,
      threadId: context.threadId,
      visibilityScope: "personal",
      grantedUserIds: [context.ownerId],
      idempotencyKey: "thread-access:personal:owner",
    });
    await expect(
      getConversationThread(
        context.db,
        context.readerId,
        context.tenantId,
        context.threadId,
      ),
    ).rejects.toMatchObject({ code: "conversation_thread_not_found" });

    await configureConversationThreadAccess(context.db, context.ownerId, {
      tenantId: context.tenantId,
      threadId: context.threadId,
      visibilityScope: "tenant",
      grantedUserIds: [],
      idempotencyKey: "thread-access:tenant:restore",
    });
    await expect(
      getConversationThread(
        context.db,
        context.excludedId,
        context.tenantId,
        context.threadId,
      ),
    ).resolves.toMatchObject({ visibilityScope: "tenant" });
    const grants = await context.db.query<{ count: number }>(
      `select count(*)::int as count
       from conversation_thread_access_grants
       where tenant_id = $1 and thread_id = $2`,
      [context.tenantId, context.threadId],
    );
    expect(grants.rows[0]?.count).toBe(0);

    const operations = await context.db.query<{ count: number }>(
      `select count(*)::int as count
       from conversation_thread_access_operations
       where tenant_id = $1 and thread_id = $2`,
      [context.tenantId, context.threadId],
    );
    expect(operations.rows[0]?.count).toBe(4);
    const audits = await context.db.query<{ action: string; safe_metadata: string }>(
      `select action, safe_metadata
       from audit_logs
       where tenant_id = $1 and target_id = $2
         and action like 'conversation.thread_access_%'
       order by created_at`,
      [context.tenantId, context.threadId],
    );
    expect(audits.rows.map((row) => row.action)).toEqual([
      "conversation.thread_access_configured",
      "conversation.thread_access_replayed",
      "conversation.thread_access_configured",
      "conversation.thread_access_configured",
      "conversation.thread_access_configured",
    ]);
    const serializedAudit = JSON.stringify(audits.rows);
    expect(serializedAudit).not.toContain(context.readerId);
    expect(serializedAudit).not.toContain(context.excludedId);
    expect(serializedAudit).not.toContain("thread-access:team:initial");
    expect(serializedAudit).not.toContain("Conversation d'accès test");
  });

  it("réserve la configuration aux administrateurs et propriétaires", async () => {
    const context = await setup();
    await expect(
      configureConversationThreadAccess(context.db, context.managerId, {
        tenantId: context.tenantId,
        threadId: context.threadId,
        visibilityScope: "team",
        grantedUserIds: [context.managerId],
        idempotencyKey: "thread-access:manager:denied",
      }),
    ).rejects.toMatchObject({ code: "tenant_access_denied" });
    const operations = await context.db.query<{ count: number }>(
      `select count(*)::int as count
       from conversation_thread_access_operations
       where tenant_id = $1`,
      [context.tenantId],
    );
    expect(operations.rows[0]?.count).toBe(0);
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: "Propriétaire accès",
    email: "thread-access-owner@example.com",
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: "Organisation accès conversation",
    category: "Services",
  });
  const readerId = await addUser(db, tenant.id, "reader", "read-only");
  const excludedId = await addUser(db, tenant.id, "excluded", "collaborator");
  const managerId = await addUser(db, tenant.id, "manager", "manager");
  const outside = await services.registerUser({
    name: "Personne externe",
    email: "thread-access-outside@example.com",
    password: "Password!1",
  });
  const message = await ingestConversationMessage(
    db,
    owner.id,
    ingressFixture(tenant.id, undefined, "initial"),
  );
  return {
    db,
    tenantId: tenant.id,
    ownerId: owner.id,
    readerId,
    excludedId,
    managerId,
    outsideUserId: outside.id,
    threadId: message.threadId,
  };
}

async function addUser(
  db: TestDb,
  tenantId: string,
  key: string,
  role: "manager" | "collaborator" | "read-only",
) {
  const services = createServices(db);
  const user = await services.registerUser({
    name: `Personne ${key}`,
    email: `thread-access-${key}@example.com`,
    password: "Password!1",
  });
  await db.query(
    `insert into memberships (tenant_id, user_id, role, created_at)
     values ($1, $2, $3, $4)`,
    [tenantId, user.id, role, timestamp],
  );
  return user.id;
}

function ingressFixture(
  tenantId: string,
  threadId: string | undefined,
  key: string,
) {
  return {
    tenantId,
    ...(threadId ? { threadId } : {}),
    channelIdentity: {
      id: `identity_thread_access_${key}`,
      tenantId,
      participantId: `participant_thread_access_${key}`,
      channelKind: "test" as const,
      adapterKey: "canal-test",
      externalSubjectId: `external_thread_access_${key}`,
      displayName: "Personne test",
      role: "member" as const,
      state: "active" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    externalMessageId: `external_message_thread_access_${key}`,
    idempotencyKey: `ingress:thread-access:${key}`,
    correlationId: `correlation_thread_access_${key}`,
    routeTrace: [],
    text: "Conversation d'accès test",
    attachments: [],
    occurredAt: timestamp,
  };
}
