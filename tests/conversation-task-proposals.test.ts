import { afterEach, expect, it, vi } from "vitest";
import { createMemoryDb, migrate, type DbClient } from "../src/lib/db";
import { configureConversationThreadAccess } from "../src/modules/conversation-hub";
import type { SqlTransactionContext } from "../src/db/client";
import { createServices } from "../src/lib/services";
import { createWebChannelAdapter } from "../src/modules/channels/web-channel";
import { prepareConversationTaskProposal as prepare, decideConversationTaskProposal as decide, listConversationTaskProposals as list } from "../src/modules/conversation-hub/task-proposals";

const opened: Awaited<ReturnType<typeof createMemoryDb>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(opened.splice(0).map(db => db.close())); });

it("conserve la proposition sans tâche puis crée une seule tâche et sa preuve après confirmation", async () => {
  const f=await fixture();
  const fetch=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("No external call"));
  const p=await prepare(f.db,f.user.id,f.tenant.id,f.input);
  expect((await list(f.db,f.user.id,f.tenant.id,f.input.threadId))[0]).toMatchObject({id:p.id,status:"pending",canConfirm:true});
  expect((await f.db.query("select * from tasks")).rows).toHaveLength(0);
  await expect(decide(f.db,f.user.id,f.tenant.id,{proposalId:p.id,decision:"approved"})).rejects.toThrow();
  const result=await decide(f.db,f.user.id,f.tenant.id,{proposalId:p.id,decision:"approved",teamVisibilityConfirmed:true});
  expect(result.status).toBe("executed");
  const replay=await decide(f.db,f.user.id,f.tenant.id,{proposalId:p.id,decision:"approved",teamVisibilityConfirmed:true});
  expect(replay).toMatchObject({taskId:result.taskId,idempotentReplay:true});
  expect((await f.db.query("select * from tasks")).rows).toHaveLength(1);
  expect((await f.db.query("select * from conversation_messages where adapter_key='native-actions'")).rows).toHaveLength(1);
  expect((await list(f.db,f.user.id,f.tenant.id,f.input.threadId))[0]).toMatchObject({status:"executed",canConfirm:false,taskId:result.taskId});
  expect(fetch).not.toHaveBeenCalled();
});

it("rend le refus terminal et ne crée aucune tâche", async () => {
  const f=await fixture(); const p=await prepare(f.db,f.user.id,f.tenant.id,f.input);
  expect((await prepare(f.db,f.user.id,f.tenant.id,f.input)).idempotentReplay).toBe(true);
  await expect(prepare(f.db,f.user.id,f.tenant.id,{...f.input,title:"Autre proposition"})).rejects.toMatchObject({code:"conversation_idempotency_conflict"});
  await decide(f.db,f.user.id,f.tenant.id,{proposalId:p.id,decision:"rejected"});
  expect((await decide(f.db,f.user.id,f.tenant.id,{proposalId:p.id,decision:"rejected"})).idempotentReplay).toBe(true);
  await expect(decide(f.db,f.user.id,f.tenant.id,{proposalId:p.id,decision:"approved",teamVisibilityConfirmed:true})).rejects.toThrow();
  expect((await f.db.query("select * from tasks")).rows).toHaveLength(0);
});

it("refuse tenant tiers, autre décideur et rôle devenu lecture seule", async () => {
  const f=await fixture();const p=await prepare(f.db,f.user.id,f.tenant.id,f.input);
  const other=await f.services.registerUser({name:"Autre",email:"other-proposal@example.test",password:"FixturePassword!1"});
  const tenant=await f.services.createTenant(other.id,{name:"Autre société",category:"Services"});
  await expect(decide(f.db,other.id,tenant.id,{proposalId:p.id,decision:"approved",teamVisibilityConfirmed:true})).rejects.toThrow();
  await f.db.query("insert into memberships(tenant_id,user_id,role,created_at) values($1,$2,'manager',$3)",[f.tenant.id,other.id,new Date().toISOString()]);
  await expect(decide(f.db,other.id,f.tenant.id,{proposalId:p.id,decision:"approved",teamVisibilityConfirmed:true})).rejects.toThrow();
  await f.db.query("update memberships set role='read-only' where tenant_id=$1 and user_id=$2",[f.tenant.id,f.user.id]);
  await expect(decide(f.db,f.user.id,f.tenant.id,{proposalId:p.id,decision:"approved",teamVisibilityConfirmed:true})).rejects.toThrow();
  expect((await f.db.query("select * from tasks")).rows).toHaveLength(0);
});

it("fige les paramètres et refuse un message modifié ou un contact archivé", async () => {
  const f=await fixture();const p=await prepare(f.db,f.user.id,f.tenant.id,f.input);
  await expect(f.db.query("update conversation_task_proposals set title='Titre modifié' where id=$1",[p.id])).rejects.toThrow("conversation_task_proposal_immutable");
  await f.db.query("update conversation_messages set text_content='Demande modifiée' where id=$1",[f.input.sourceMessageId]);
  await expect(decide(f.db,f.user.id,f.tenant.id,{proposalId:p.id,decision:"approved",teamVisibilityConfirmed:true})).rejects.toThrow();
  expect((await list(f.db,f.user.id,f.tenant.id,f.input.threadId))[0].canConfirm).toBe(false);
  expect((await f.db.query("select * from tasks")).rows).toHaveLength(0);
});

it("annule tâche, rapport et décision si l'audit de décision échoue", async () => {
  const f=await fixture();const p=await prepare(f.db,f.user.id,f.tenant.id,f.input);
  await f.db.exec(`create function fail_proposal_audit() returns trigger language plpgsql as $$ begin
    if new.action='conversation.task_proposal.executed' then raise exception 'proposal_audit_failure'; end if;return new;end $$;
    create trigger fail_proposal_audit before insert on audit_logs for each row execute function fail_proposal_audit()`);
  await expect(decide(f.db,f.user.id,f.tenant.id,{proposalId:p.id,decision:"approved",teamVisibilityConfirmed:true})).rejects.toThrow("proposal_audit_failure");
  expect((await f.db.query("select * from tasks")).rows).toHaveLength(0);
  expect((await f.db.query("select * from conversation_messages where adapter_key='native-actions'")).rows).toHaveLength(0);
  expect((await list(f.db,f.user.id,f.tenant.id,f.input.threadId))[0].status).toBe("pending");
});

async function fixture(){
  const db=await createMemoryDb();opened.push(db);const services=createServices(db);
  const user=await services.registerUser({name:"Recette guidée",email:"proposal@example.test",password:"FixturePassword!1"});
  const tenant=await services.createTenant(user.id,{name:"Entreprise guidée",category:"Services"});const now=new Date().toISOString();
  await db.query(`insert into contacts(id,tenant_id,name,email,phone,status,source,tags,assigned_user_id,created_at,updated_at)
    values('contact_proposal',$1,'Contact guidé','','','active','manual','[]',$2,$3,$3)`,[tenant.id,user.id,now]);
  const message=await createWebChannelAdapter(db).ingest(user.id,{tenantId:tenant.id,displayName:user.name,externalMessageId:"proposal-source",idempotencyKey:"proposal:source",correlationId:"proposal:test",text:"Prévoir une relance du devis.",occurredAt:now});
  return {db,services,user,tenant,input:{threadId:message.threadId,sourceMessageId:message.messageId,contactId:"contact_proposal",title:"Rappeler le contact pour son devis",dueAt:new Date(Date.now()+86400000).toISOString(),idempotencyKey:"proposal:prepare"}};
}

it("applique la RLS du fil privé et exécute avec le rôle limité sans conserver son contexte", async () => {
  const f=await fixture();const other=await f.services.registerUser({name:"Membre",email:"private-proposal@example.test",password:"FixturePassword!1"});
  await f.db.query("insert into memberships(tenant_id,user_id,role,created_at) values($1,$2,'manager',$3)",[f.tenant.id,other.id,new Date().toISOString()]);
  await configureConversationThreadAccess(f.db,f.user.id,{tenantId:f.tenant.id,threadId:f.input.threadId,visibilityScope:"personal",grantedUserIds:[f.user.id],idempotencyKey:"proposal:private"});
  const p=await prepare(f.db,f.user.id,f.tenant.id,f.input);
  await migrate(f.db,{enableRls:true});
  await f.db.exec(`create role proposal_owner;create role proposal_runtime;
    do $$ declare r record;begin for r in select tablename from pg_tables where schemaname='public' loop
      execute format('alter table public.%I owner to proposal_owner',r.tablename);end loop;end $$;
    grant proposal_owner to proposal_runtime with inherit false,set false;
    grant usage on schema public to proposal_runtime;grant select,insert,update,delete on all tables in schema public to proposal_runtime;
    set role proposal_runtime`);
  const runtime={__runtime:"postgres",query:(sql:string,params?:unknown[])=>f.db.query(sql,params),
    __withTransaction:(ctx:SqlTransactionContext,callback:(tx:DbClient)=>Promise<unknown>)=>f.db.transaction(async tx=>{
      if(ctx.tenantId)await tx.query("select set_config('app.tenant_id',$1,true)",[ctx.tenantId]);
      if(ctx.actorId)await tx.query("select set_config('app.actor_id',$1,true)",[ctx.actorId]);
      if(ctx.systemAccess)await tx.query("select set_config('app.system_access','true',true)");
      return callback({__runtime:"postgres",__transaction:true,query:(sql:string,params?:unknown[])=>tx.query(sql,params)} as DbClient);
    })} as unknown as DbClient;
  expect((await runtime.query("select * from conversation_task_proposals")).rows).toHaveLength(0);
  await expect(list(runtime,other.id,f.tenant.id,f.input.threadId)).rejects.toThrow();
  expect((await list(runtime,f.user.id,f.tenant.id,f.input.threadId))[0].status).toBe("pending");
  const result=await decide(runtime,f.user.id,f.tenant.id,{proposalId:p.id,decision:"approved",teamVisibilityConfirmed:true});
  expect(result.status).toBe("executed");
  expect((await runtime.query("select * from conversation_task_proposals")).rows).toHaveLength(0);
  expect((await runtime.query("select current_setting('app.system_access',true) as value")).rows[0].value).not.toBe("true");
  await f.db.exec("reset role");
});
