import { afterEach, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { createWebChannelAdapter } from "../src/modules/channels/web-channel";
import { createConversationContactTask } from "../src/modules/conversation-hub/native-tasks";

const opened: Awaited<ReturnType<typeof createMemoryDb>>[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((db) => db.close())); });

it("crée une vraie tâche CRM et une preuve dans le fil, sans doublon ni fournisseur", async () => {
  const f = await fixture();
  const first = await createConversationContactTask(f.db, f.user.id, f.tenant.id, f.input);
  const replay = await createConversationContactTask(f.db, f.user.id, f.tenant.id, f.input);
  expect(first.idempotentReplay).toBe(false);
  expect(replay).toMatchObject({ ...first, idempotentReplay: true });
  const tasks = (await f.db.query<{ id: string; related_id: string; title: string }>("select * from tasks")).rows;
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({ id: first.taskId, related_id: "contact_native", title: f.input.title });
  const reports = await f.db.query("select * from conversation_messages where adapter_key = 'native-actions'");
  expect(reports.rows).toHaveLength(1);
  await expect(createConversationContactTask(f.db, f.user.id, f.tenant.id, { ...f.input, title: "Autre tâche" }))
    .rejects.toMatchObject({ code: "conversation_idempotency_conflict" });
  expect((await f.db.query("select * from tasks")).rows).toHaveLength(1);
});

it("refuse l'absence de confirmation de visibilité, le rôle lecture seule et les cibles hors tenant", async () => {
  const f = await fixture();
  await expect(createConversationContactTask(f.db, f.user.id, f.tenant.id,
    { ...f.input, teamVisibilityConfirmed: false } as unknown as typeof f.input)).rejects.toThrow();
  const other = await f.services.createTenant(f.user.id, { name: "Autre entreprise", category: "Services" });
  await expect(createConversationContactTask(f.db, f.user.id, other.id, f.input))
    .rejects.toMatchObject({ code: "conversation_access_denied" });
  await f.db.query("update memberships set role = 'read-only' where tenant_id = $1", [f.tenant.id]);
  await expect(createConversationContactTask(f.db, f.user.id, f.tenant.id, f.input))
    .rejects.toMatchObject({ code: "tenant_access_denied" });
  expect((await f.db.query("select * from tasks")).rows).toHaveLength(0);
});

it("annule tâche, activité et rapport si l'audit final échoue", async () => {
  const f = await fixture();
  await f.db.exec(`create function reject_native_task_audit() returns trigger language plpgsql as $$
    begin if new.action = 'conversation.native_task.created' then raise exception 'fixture_native_audit_failure'; end if; return new; end $$;
    create trigger reject_native_task_audit before insert on audit_logs for each row execute function reject_native_task_audit()`);
  await expect(createConversationContactTask(f.db, f.user.id, f.tenant.id, f.input)).rejects.toThrow("fixture_native_audit_failure");
  expect((await f.db.query("select * from tasks")).rows).toHaveLength(0);
  expect((await f.db.query("select * from activities where type = 'task.created'")).rows).toHaveLength(0);
  expect((await f.db.query("select * from conversation_messages where adapter_key = 'native-actions'")).rows).toHaveLength(0);
});

async function fixture() {
  const db = await createMemoryDb(); opened.push(db);
  const services = createServices(db);
  const user = await services.registerUser({ name: "Responsable", email: "native-task@example.test", password: "FixturePassword!1" });
  const tenant = await services.createTenant(user.id, { name: "Entreprise native", category: "Services" });
  const now = new Date().toISOString();
  await db.query(`insert into contacts (id, tenant_id, name, email, phone, status, source, tags, assigned_user_id, created_at, updated_at)
    values ('contact_native', $1, 'Contact de recette', 'contact@example.test', '', 'active', 'manual', '[]', $2, $3, $3)`, [tenant.id, user.id, now]);
  const thread = await createWebChannelAdapter(db).ingest(user.id, { tenantId: tenant.id, displayName: user.name,
    externalMessageId: "native-task-source", idempotencyKey: "native-task:source", correlationId: "native-task:fixture",
    text: "Prévoir une relance du contact", occurredAt: now });
  return { db, services, user, tenant, input: {
    threadId: thread.threadId, sourceMessageId: thread.messageId, contactId: "contact_native",
    title: "Relance réelle dans le CRM", dueAt: "2027-01-01T12:00:00Z", idempotencyKey: "native-task:confirmed",
    teamVisibilityConfirmed: true as const,
  } };
}
