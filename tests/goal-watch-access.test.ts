import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  archiveBusinessBrainEntry as archiveBusinessBrainEntryRecord,
  findActiveBusinessBrainEntry,
  insertBusinessBrainEntry,
  insertBusinessBrainEvidence,
  listActiveBusinessBrainEntries,
  listActiveBusinessBrainEvidence,
  supersedeBusinessBrainEntry,
} from "../src/modules/business-brain/repository";
import {
  configureConversationThreadAccess,
  ingestConversationMessage,
} from "../src/modules/conversation-hub/service";
import {
  createGoalWatch,
  getGoalWatch,
} from "../src/modules/goal-watch";

const opened: Array<{ close: () => Promise<void> }> = [];
const timestamp = "2026-08-20T12:00:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("accès aux objectifs internes Goal Watch", () => {
  it("hérite de l’accès au fil et refuse la création sans autorisation", async () => {
    const context = await createContext();
    const goal = await seedInternalGoal(context);

    await expect(
      getGoalWatch(
        context.db,
        context.ownerId,
        context.tenantId,
        goal.goalId,
      ),
    ).resolves.toMatchObject({
      goalId: goal.goalId,
      threadId: context.threadId,
    });

    await expect(
      getGoalWatch(
        context.db,
        context.memberId,
        context.tenantId,
        goal.goalId,
      ),
    ).rejects.toMatchObject({ code: "goal_watch_not_found" });

    await expect(
      createGoalWatch(
        context.db,
        context.memberId,
        context.tenantId,
        {
          threadId: context.threadId,
          title: "Objectif non autorisé",
          signal: "contacts",
          operator: "gte",
          target: 1,
        },
      ),
    ).rejects.toMatchObject({ code: "goal_watch_thread_not_found" });

    const entriesAfterDeniedCreation = await context.db.query<{
      count: number;
    }>(
      `select count(*)::int as count
       from business_brain_entries
       where tenant_id = $1`,
      [context.tenantId],
    );
    expect(entriesAfterDeniedCreation.rows[0]?.count).toBe(1);

    await configureConversationThreadAccess(
      context.db,
      context.ownerId,
      {
        tenantId: context.tenantId,
        threadId: context.threadId,
        visibilityScope: "team",
        grantedUserIds: [context.ownerId, context.memberId],
        idempotencyKey: "goal-watch:access:grant",
      },
    );

    await expect(
      getGoalWatch(
        context.db,
        context.memberId,
        context.tenantId,
        goal.goalId,
      ),
    ).resolves.toMatchObject({ goalId: goal.goalId });

    await configureConversationThreadAccess(
      context.db,
      context.ownerId,
      {
        tenantId: context.tenantId,
        threadId: context.threadId,
        visibilityScope: "personal",
        grantedUserIds: [context.ownerId],
        idempotencyKey: "goal-watch:access:revoke",
      },
    );

    await expect(
      getGoalWatch(
        context.db,
        context.memberId,
        context.tenantId,
        goal.goalId,
      ),
    ).rejects.toMatchObject({ code: "goal_watch_not_found" });
  });

  it("réserve les entrées et preuves internes au module Goal Watch", async () => {
    const context = await createContext();
    const goal = await seedInternalGoal(context);
    const manualId = await context.services.createBusinessBrainEntry(
      context.ownerId,
      context.tenantId,
      manualInput(),
    );

    for (const userId of [context.ownerId, context.memberId]) {
      const workspace = await context.services.getBusinessBrain(
        userId,
        context.tenantId,
      );
      expect(workspace.entries.map((entry) => entry.id)).toEqual([manualId]);
      expect(JSON.stringify(workspace)).not.toContain("Titre objectif privé");
      expect(JSON.stringify(workspace)).not.toContain(goal.goalId);

      await expect(
        context.services.reviseBusinessBrainEntry(
          userId,
          context.tenantId,
          { ...manualInput(), entryId: goal.entryId },
        ),
      ).rejects.toMatchObject({ code: "business_brain_entry_not_found" });

      await expect(
        context.services.archiveBusinessBrainEntry(
          userId,
          context.tenantId,
          { entryId: goal.entryId },
        ),
      ).rejects.toMatchObject({ code: "business_brain_entry_not_found" });
    }

    const entries = await listActiveBusinessBrainEntries(
      context.db,
      context.tenantId,
    );
    expect(entries.map((entry) => entry.id)).toEqual([manualId]);

    const evidence = await listActiveBusinessBrainEvidence(
      context.db,
      context.tenantId,
    );
    expect(evidence.map((item) => item.entry_id)).toEqual([manualId]);

    await expect(
      findActiveBusinessBrainEntry(
        context.db,
        context.tenantId,
        goal.entryId,
      ),
    ).resolves.toBeNull();
    await expect(
      supersedeBusinessBrainEntry(
        context.db,
        context.tenantId,
        goal.entryId,
        timestamp,
      ),
    ).resolves.toBeNull();
    await expect(
      archiveBusinessBrainEntryRecord(
        context.db,
        context.tenantId,
        goal.entryId,
        timestamp,
      ),
    ).resolves.toBeNull();

    // Le chemin spécialisé reste fonctionnel pour le propriétaire autorisé.
    await expect(
      getGoalWatch(
        context.db,
        context.ownerId,
        context.tenantId,
        goal.goalId,
      ),
    ).resolves.toMatchObject({
      goalId: goal.goalId,
      title: "Titre objectif privé",
    });

    const stored = await context.db.query<{
      status: string;
      version: number;
    }>(
      `select status, version
       from business_brain_entries
       where tenant_id = $1 and id = $2`,
      [context.tenantId, goal.entryId],
    );
    expect(stored.rows).toEqual([{ status: "active", version: 1 }]);

    const mutationAudits = await context.db.query<{ count: number }>(
      `select count(*)::int as count
       from audit_logs
       where tenant_id = $1
         and action in (
           'business_brain.entry_revised',
           'business_brain.entry_archived'
         )`,
      [context.tenantId],
    );
    expect(mutationAudits.rows[0]?.count).toBe(0);
  });

  it("refuse l’usurpation de la référence interne par création ou révision", async () => {
    const context = await createContext();
    const manualId = await context.services.createBusinessBrainEntry(
      context.ownerId,
      context.tenantId,
      manualInput(),
    );

    for (const sourceRef of ["goal-watch:v1", " goal-watch:v1 "]) {
      await expect(
        context.services.createBusinessBrainEntry(
          context.memberId,
          context.tenantId,
          { ...manualInput(), sourceRef },
        ),
      ).rejects.toThrow(
        "Cette référence est réservée au suivi d’objectifs.",
      );

      await expect(
        context.services.reviseBusinessBrainEntry(
          context.memberId,
          context.tenantId,
          { ...manualInput(), entryId: manualId, sourceRef },
        ),
      ).rejects.toThrow(
        "Cette référence est réservée au suivi d’objectifs.",
      );
    }

    const rows = await context.db.query<{
      id: string;
      status: string;
      source_ref: string | null;
      version: number;
    }>(
      `select id, status, source_ref, version
       from business_brain_entries
       where tenant_id = $1`,
      [context.tenantId],
    );
    expect(rows.rows).toEqual([
      { id: manualId, status: "active", source_ref: null, version: 1 },
    ]);

    const audit = await context.db.query<{ count: number }>(
      `select count(*)::int as count
       from audit_logs
       where tenant_id = $1 and action like 'business_brain.%'`,
      [context.tenantId],
    );
    expect(audit.rows[0]?.count).toBe(1);
  });
});

function manualInput() {
  return {
    domain: "objectives" as const,
    title: "Objectif manuel ordinaire",
    summary: "Conserver les objectifs manuels dans la mémoire générique.",
    details: "Aucune programmation automatique.",
    confidence: 90,
    sourceType: "manual" as const,
    evidenceType: "observation" as const,
    evidenceSummary: "Information manuelle autorisée.",
  };
}

async function createContext() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: "Propriétaire",
    email: "goal-access-owner@example.com",
    password: "Password!1",
  });
  const member = await services.registerUser({
    name: "Collaborateur",
    email: "goal-access-member@example.com",
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: "Organisation Goal Access",
    category: "Services",
  });
  await db.query(
    `insert into memberships (tenant_id, user_id, role, created_at)
     values ($1, $2, 'collaborator', $3)`,
    [tenant.id, member.id, timestamp],
  );

  const ingress = await ingestConversationMessage(db, owner.id, {
    tenantId: tenant.id,
    channelIdentity: {
      id: "identity_goal_access",
      tenantId: tenant.id,
      participantId: "participant_goal_access",
      channelKind: "test",
      adapterKey: "canal-test",
      externalSubjectId: "visitor_goal_access",
      displayName: "Cliente test",
      role: "customer",
      state: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    externalMessageId: "external_goal_access",
    idempotencyKey: "goal-watch:access:ingress",
    correlationId: "goal-watch:access:correlation",
    routeTrace: [],
    text: "Conversation de test à accès contrôlé.",
    attachments: [],
    occurredAt: timestamp,
  });

  await configureConversationThreadAccess(db, owner.id, {
    tenantId: tenant.id,
    threadId: ingress.threadId,
    visibilityScope: "personal",
    grantedUserIds: [owner.id],
    idempotencyKey: "goal-watch:access:private",
  });

  return {
    db,
    services,
    ownerId: owner.id,
    memberId: member.id,
    tenantId: tenant.id,
    threadId: ingress.threadId,
  };
}

async function seedInternalGoal(
  context: Awaited<ReturnType<typeof createContext>>,
) {
  const entryId = "brain_entry_goal_access";
  const goalId = "goal_watch_access";

  // Fixture SQL : aucun service de programmation ou de maintenance appelé.
  await insertBusinessBrainEntry(context.db, {
    id: entryId,
    tenantId: context.tenantId,
    entryKey: goalId,
    domain: "objectives",
    title: "Titre objectif privé",
    summary: "Configuration interne réservée.",
    details: JSON.stringify({
      schemaVersion: 1,
      threadId: context.threadId,
      signal: "contacts",
      operator: "gte",
      target: 1,
      cadenceMinutes: 60,
    }),
    sourceType: "manual",
    sourceRef: "goal-watch:v1",
    confidence: 100,
    version: 1,
    actorId: context.ownerId,
    now: timestamp,
  });
  await insertBusinessBrainEvidence(context.db, {
    id: "brain_evidence_goal_access",
    tenantId: context.tenantId,
    entryId,
    evidenceType: "system_record",
    sourceRef: goalId,
    summary: "Preuve interne privée.",
    actorId: context.ownerId,
    now: timestamp,
  });

  return { entryId, goalId };
}
