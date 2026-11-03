import { afterEach, expect, it } from "vitest";
import { createMemoryDb, migrate, type DbClient } from "../src/lib/db";
import type { SqlClient, SqlTransactionContext } from "../src/db/client";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import { submitPublicLead } from "../src/modules/crm/leads";
import { getPublishedSite } from "../src/modules/websites/service";

const opened: Awaited<ReturnType<typeof createMemoryDb>>[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(db => db.close())); });

it("ingests and replays a published form with tenant-only RLS context, audit and one workflow", async () => {
  const f = await fixture();
  const workspace = await f.services.getWebsiteWorkspace(f.user.id, f.tenant.id);
  const contact = workspace.sections.find(section => section.type === "contact")!;
  await f.services.updateWebsiteSection(f.user.id, f.tenant.id, contact.id, {
    title: contact.title, body: contact.body, imageUrl: contact.imageUrl,
    buttonLabel: contact.buttonLabel, buttonHref: contact.buttonHref, enabled: false,
  });
  // The unpublished edit must not disable the still-published contact form.
  await useRuntimeRole(f.db);
  const contexts: SqlTransactionContext[] = [];
  const runtime = runtimeClient(f.db, contexts);
  const identity = await runtime.query<{ superuser: boolean; bypass: boolean }>(
    "select rolsuper as superuser, rolbypassrls as bypass from pg_roles where rolname=current_user",
  );
  expect(identity.rows[0]).toEqual({ superuser: false, bypass: false });
  expect((await runtime.query("select * from contacts")).rows).toHaveLength(0);
  expect(await getPublishedSite(runtime, f.tenant.slug)).not.toBeNull();

  const payload = { name: "Contact formulaire fictif", email: "public-runtime@example.test", phone: "+596696000000", message: "Demande fictive", idempotencyKey: "public-runtime-idempotency" };
  const result = await submitPublicLead(runtime, f.tenant.slug, payload, { getPublishedSite });
  expect(result).toMatch(/^lead_/);
  for (let attempt = 0; attempt < 11; attempt += 1) {
    await expect(submitPublicLead(runtime, f.tenant.slug, payload, { getPublishedSite })).resolves.toBeTruthy();
  }

  expect(contexts).toHaveLength(12);
  expect(contexts.every(context => context.tenantId === f.tenant.id && context.actorId === "system" && !context.systemAccess)).toBe(true);
  const clean = await runtime.query<{ tenant: string | null; system: string | null }>(
    "select nullif(current_setting('app.tenant_id', true),'') as tenant, nullif(current_setting('app.system_access',true),'') as system",
  );
  expect(clean.rows[0]).toEqual({ tenant: null, system: null });
  expect((await runtime.query("select * from contacts")).rows).toHaveLength(0);
  expect((await runtime.query("select * from form_submissions")).rows).toHaveLength(0);

  await f.db.exec("reset role");
  const count = async (table: string, suffix = "", params: unknown[] = []) => {
    const rows = await f.db.query<{ count: number }>(`select count(*)::int as count from ${table} where tenant_id=$1 ${suffix}`, [f.tenant.id, ...params]);
    return rows.rows[0]?.count;
  };
  expect(await count("contacts")).toBe(1);
  expect(await count("leads")).toBe(1);
  expect(await count("form_submissions")).toBe(1);
  expect(await count("domain_events", "and event_type=$2", ["lead.created"])).toBe(1);
  expect(await count("audit_logs", "and action=$2", ["form.submitted"])).toBe(1);
  expect(await count("audit_logs", "and action=$2", ["lead.created"])).toBe(1);
  expect(await count("audit_logs", "and action=$2", ["workflow.enqueued"])).toBe(1);
  const rate = await f.db.query<{ count: number }>("select count from rate_limits where operation_key='public_form.submit'");
  expect(rate.rows).toEqual([{ count: 1 }]);
});

it("refuses unpublished sites and a disabled published contact form before writes", async () => {
  const f = await fixture();
  const unpublished = await f.services.createTenant(f.user.id, { name: "Brouillon local", category: "Services" });
  await f.services.saveOnboarding(f.user.id, unpublished.id, defaultGarageOnboarding());
  const workspace = await f.services.getWebsiteWorkspace(f.user.id, f.tenant.id);
  const contact = workspace.sections.find(section => section.type === "contact")!;
  await f.services.updateWebsiteSection(f.user.id, f.tenant.id, contact.id, { title: contact.title, body: contact.body, imageUrl: contact.imageUrl, buttonLabel: contact.buttonLabel, buttonHref: contact.buttonHref, enabled: false });
  await f.services.publishWebsite(f.user.id, f.tenant.id);
  await useRuntimeRole(f.db);
  const contexts: SqlTransactionContext[] = [];
  const runtime = runtimeClient(f.db, contexts);
  const payload = { name: "Refus fictif", email: "public-refused@example.test", phone: "+596696000000", message: "Doit être refusé", idempotencyKey: "public-disabled-form" };
  await expect(submitPublicLead(runtime, unpublished.slug, payload, { getPublishedSite })).rejects.toMatchObject({ code: "published_site_not_found" });
  await expect(submitPublicLead(runtime, f.tenant.slug, payload, { getPublishedSite })).rejects.toMatchObject({ code: "invalid_lead_payload" });
  expect(contexts).toHaveLength(0);
  await f.db.exec("reset role");
  expect((await f.db.query("select id from contacts")).rows).toHaveLength(0);
  expect((await f.db.query("select id from form_submissions")).rows).toHaveLength(0);
  expect((await f.db.query("select id from rate_limits where operation_key='public_form.submit'")).rows).toHaveLength(0);
});

async function fixture() {
  const db = await createMemoryDb(); opened.push(db);
  const services = createServices(db);
  const user = await services.registerUser({ name: "Formulaire public local", email: "owner-public-form@example.test", password: "FixturePassword!1" });
  const tenant = await services.createTenant(user.id, { name: "Publication locale", category: "Services" });
  await services.saveOnboarding(user.id, tenant.id, defaultGarageOnboarding());
  await services.publishWebsite(user.id, tenant.id);
  return { db, services, user, tenant };
}

async function useRuntimeRole(db: Awaited<ReturnType<typeof createMemoryDb>>) {
  await migrate(db, { enableRls: true });
  await db.exec("create role public_lead_runtime; grant usage on schema public,app_private to public_lead_runtime; grant select,insert,update,delete on all tables in schema public to public_lead_runtime; grant execute on function app_private.app_public_site_by_slug(text) to public_lead_runtime; set role public_lead_runtime");
}

function runtimeClient(db: DbClient, contexts: SqlTransactionContext[]): SqlClient {
  const query: DbClient["query"] = (sql, params) => db.query(sql, params);
  return {
    __runtime: "postgres",
    query,
    async __withTransaction(context, callback) {
      contexts.push(context);
      await db.query("begin");
      try {
        if (context.tenantId) await db.query("select set_config('app.tenant_id',$1,true)", [context.tenantId]);
        if (context.actorId) await db.query("select set_config('app.actor_id',$1,true)", [context.actorId]);
        if (context.systemAccess) throw new Error("Global system context forbidden in this fixture");
        const result = await callback({ __runtime: "postgres", __transaction: true, query });
        await db.query("commit");
        return result;
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    },
  };
}
