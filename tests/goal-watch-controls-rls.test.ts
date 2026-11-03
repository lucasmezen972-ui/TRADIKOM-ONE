import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createMemoryDb, migrate } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { createWebChannelAdapter } from "../src/modules/channels/web-channel";
import { configureConversationThreadAccess } from "../src/modules/conversation-hub/service";
import { createGoalWatch } from "../src/modules/goal-watch";

it("protège l'objectif, son consentement, ses preuves et ses audits selon l'accès réel au fil", async () => {
  const db = await createMemoryDb();
  try {
    const services = createServices(db);
    const owner = await services.registerUser({ name: "Propriétaire", email: "goal-owner@example.test", password: "FixturePassword!1" });
    const member = await services.registerUser({ name: "Collègue", email: "goal-member@example.test", password: "FixturePassword!1" });
    const tenant = await services.createTenant(owner.id, { name: "Entreprise objectif", category: "Services" });
    await db.query(`insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, 'collaborator', $3)`, [tenant.id, member.id, new Date().toISOString()]);
    const thread = await createWebChannelAdapter(db).ingest(owner.id, { tenantId: tenant.id,
      displayName: owner.name, externalMessageId: "goal-rls-message", idempotencyKey: "goal-rls:ingress",
      correlationId: "goal-rls:correlation", text: "Objectif privé", occurredAt: new Date().toISOString() });
    await configureConversationThreadAccess(db, owner.id, { tenantId: tenant.id, threadId: thread.threadId,
      visibilityScope: "personal", grantedUserIds: [owner.id], idempotencyKey: "goal-rls:private" });
    const goal = await createGoalWatch(db, owner.id, tenant.id, { threadId: thread.threadId,
      title: "Indicateur privé", signal: "contacts", operator: "gte", target: 1, consentConfirmed: true, idempotencyKey: `goal-create:${randomUUID()}` });
    await migrate(db, { enableRls: true });
    await migrate(db, { enableRls: true });
    await db.exec(`create role goal_rls_client;
      grant usage on schema public to goal_rls_client;
      grant select, insert, update, delete on all tables in schema public to goal_rls_client;
      set role goal_rls_client`);
    await db.query("select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false)", [tenant.id, member.id]);
    for (const table of ["business_brain_entries", "business_brain_evidence", "goal_watch_controls"]) {
      expect((await db.query(`select * from ${table} where tenant_id = $1`, [tenant.id])).rows, table).toHaveLength(0);
    }
    expect((await db.query("select * from audit_logs where tenant_id = $1 and target_type = 'goal_watch'", [tenant.id])).rows).toHaveLength(0);
    const denied = await db.query(`update goal_watch_controls set state = 'stopped', version = 2, updated_by = $2
      where tenant_id = $1 returning entry_id`, [tenant.id, member.id]);
    expect(denied.rows).toHaveLength(0);

    await db.query("select set_config('app.actor_id', $1, false)", [owner.id]);
    expect((await db.query("select * from goal_watch_controls where tenant_id = $1", [tenant.id])).rows).toHaveLength(1);
    expect((await db.query("select * from business_brain_entries where tenant_id = $1", [tenant.id])).rows).toHaveLength(1);
    await expect(db.query("update business_brain_entries set source_ref = 'other' where id = $1", [goal.entryId])).rejects.toThrow("goal_watch_entry_immutable");
    await expect(db.query("update goal_watch_controls set next_due_at = now() where tenant_id = $1", [tenant.id])).rejects.toThrow("goal_watch_schedule_system_only");
    await db.query(`update goal_watch_controls set state = 'paused', version = 2, updated_by = $2, updated_at = $3
      where tenant_id = $1`, [tenant.id, owner.id, new Date().toISOString()]);
    expect((await db.query<{ state: string }>("select state from goal_watch_controls where tenant_id = $1", [tenant.id])).rows[0].state).toBe("paused");
    await db.query("select set_config('app.tenant_id', 'other_tenant', false)");
    expect((await db.query("select * from goal_watch_controls")).rows).toHaveLength(0);
    await db.exec("reset role");
  } finally { await db.close(); }
});
