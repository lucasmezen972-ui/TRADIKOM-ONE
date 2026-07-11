import type { DbClient } from "@/lib/db";
import { safeJson } from "@/lib/security";
import type { Activity, Contact, Lead, Task } from "@/lib/types";

type ContactRow = {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  source: string;
  tags: string;
  assigned_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type LeadRow = {
  id: string;
  tenant_id: string;
  contact_id: string;
  source: string;
  status: string;
  opportunity_value: number;
  page_path: string;
  created_at: string;
};

type TaskRow = {
  id: string;
  tenant_id: string;
  title: string;
  status: "open" | "done";
  assigned_user_id: string;
  due_at: string;
  related_type: string;
  related_id: string;
  created_at: string;
};

type ActivityRow = {
  id: string;
  tenant_id: string;
  type: string;
  summary: string;
  target_type: string;
  target_id: string;
  created_at: string;
};

type NoteRow = {
  id: string;
  tenant_id: string;
  body: string;
  target_type: string;
  target_id: string;
  created_at: string;
};

type ContactConsentRow = {
  id: string;
  tenant_id: string;
  contact_id: string;
  marketing_opt_in: number;
  privacy_notice_accepted_at: string | null;
  data_retention_until: string | null;
};

type OpportunityRow = {
  id: string;
  tenant_id: string;
  contact_id: string;
  stage_id: string;
  stage_name: string;
  value_cents: number;
  next_follow_up_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listContacts(db: DbClient, tenantId: string) {
  const contacts = await db.query<ContactRow>(
    "select * from contacts where tenant_id = $1 order by updated_at desc",
    [tenantId],
  );

  return contacts.rows.map(mapContact);
}

export async function listLeads(db: DbClient, tenantId: string) {
  const leads = await db.query<LeadRow>(
    "select * from leads where tenant_id = $1 order by created_at desc",
    [tenantId],
  );

  return leads.rows.map(mapLead);
}

export async function listTasks(db: DbClient, tenantId: string) {
  const tasks = await db.query<TaskRow>(
    "select * from tasks where tenant_id = $1 order by created_at desc",
    [tenantId],
  );

  return tasks.rows.map(mapTask);
}

export async function listActivities(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const rows = await db.query<ActivityRow>(
    `select * from activities where tenant_id = $1 order by created_at desc limit ${Number(
      limit,
    )}`,
    [tenantId],
  );

  return rows.rows.map(mapActivity);
}

export async function findContactById(
  db: DbClient,
  tenantId: string,
  contactId: string,
) {
  const contact = await db.query<ContactRow>(
    "select * from contacts where tenant_id = $1 and id = $2",
    [tenantId, contactId],
  );

  return contact.rows[0] ? mapContact(contact.rows[0]) : null;
}

export async function updateContact(
  db: DbClient,
  input: {
    tenantId: string;
    contactId: string;
    name: string;
    phone: string;
    status: string;
    tags: string;
    assignedUserId: string | null;
    updatedAt: string;
  },
) {
  const result = await db.query<ContactRow>(
    `update contacts
     set name = $1, phone = $2, status = $3, tags = $4, assigned_user_id = $5, updated_at = $6
     where tenant_id = $7 and id = $8
     returning *`,
    [
      input.name,
      input.phone,
      input.status,
      input.tags,
      input.assignedUserId,
      input.updatedAt,
      input.tenantId,
      input.contactId,
    ],
  );

  return result.rows[0] ? mapContact(result.rows[0]) : null;
}

export async function listContactNotes(
  db: DbClient,
  tenantId: string,
  contactId: string,
) {
  const result = await db.query<NoteRow>(
    `select *
     from notes
     where tenant_id = $1 and target_type = $2 and target_id = $3
     order by created_at desc`,
    [tenantId, "contact", contactId],
  );

  return result.rows.map(mapNote);
}

export async function insertContactNote(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    contactId: string;
    body: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into notes (id, tenant_id, body, target_type, target_id, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.id,
      input.tenantId,
      input.body,
      "contact",
      input.contactId,
      input.createdAt,
    ],
  );
}

export async function findContactConsent(
  db: DbClient,
  tenantId: string,
  contactId: string,
) {
  const result = await db.query<ContactConsentRow>(
    `select *
     from contact_consents
     where tenant_id = $1 and contact_id = $2
     limit 1`,
    [tenantId, contactId],
  );

  return result.rows[0] ? mapContactConsent(result.rows[0]) : null;
}

export async function insertContactConsent(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    contactId: string;
    marketingOptIn: boolean;
    privacyNoticeAcceptedAt: string | null;
    dataRetentionUntil: string | null;
  },
) {
  await db.query(
    `insert into contact_consents (id, tenant_id, contact_id, marketing_opt_in, privacy_notice_accepted_at, data_retention_until)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.id,
      input.tenantId,
      input.contactId,
      input.marketingOptIn ? 1 : 0,
      input.privacyNoticeAcceptedAt,
      input.dataRetentionUntil,
    ],
  );
}

export async function updateContactConsent(
  db: DbClient,
  input: {
    tenantId: string;
    consentId: string;
    marketingOptIn: boolean;
    privacyNoticeAcceptedAt: string | null;
    dataRetentionUntil: string | null;
  },
) {
  await db.query(
    `update contact_consents
     set marketing_opt_in = $1, privacy_notice_accepted_at = $2, data_retention_until = $3
     where tenant_id = $4 and id = $5`,
    [
      input.marketingOptIn ? 1 : 0,
      input.privacyNoticeAcceptedAt,
      input.dataRetentionUntil,
      input.tenantId,
      input.consentId,
    ],
  );
}

export async function listContactTasks(
  db: DbClient,
  tenantId: string,
  contactId: string,
) {
  const result = await db.query<TaskRow>(
    `select *
     from tasks
     where tenant_id = $1
       and (
         (related_type = $2 and related_id = $3)
         or (
           related_type = $4
           and related_id in (
             select id from leads where tenant_id = $1 and contact_id = $3
           )
         )
       )
     order by status asc, due_at asc, created_at desc`,
    [tenantId, "contact", contactId, "lead"],
  );

  return result.rows.map(mapTask);
}

export async function findContactTaskById(
  db: DbClient,
  tenantId: string,
  contactId: string,
  taskId: string,
) {
  const result = await db.query<TaskRow>(
    `select *
     from tasks
     where tenant_id = $1
       and id = $2
       and (
         (related_type = $3 and related_id = $4)
         or (
           related_type = $5
           and related_id in (
             select id from leads where tenant_id = $1 and contact_id = $4
           )
         )
       )
     limit 1`,
    [tenantId, taskId, "contact", contactId, "lead"],
  );

  return result.rows[0] ? mapTask(result.rows[0]) : null;
}

export async function insertContactTask(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    contactId: string;
    title: string;
    assignedUserId: string;
    dueAt: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into tasks (id, tenant_id, title, status, assigned_user_id, due_at, related_type, related_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.id,
      input.tenantId,
      input.title,
      "open",
      input.assignedUserId,
      input.dueAt,
      "contact",
      input.contactId,
      input.createdAt,
    ],
  );
}

export async function completeTask(
  db: DbClient,
  tenantId: string,
  taskId: string,
) {
  await db.query(
    "update tasks set status = $1 where tenant_id = $2 and id = $3",
    ["done", tenantId, taskId],
  );
}

export async function listContactActivities(
  db: DbClient,
  tenantId: string,
  contactId: string,
) {
  const result = await db.query<ActivityRow>(
    `select *
     from activities
     where tenant_id = $1
       and (
         (target_type = $2 and target_id = $3)
         or (
           target_type = $4
           and target_id in (
             select id from leads where tenant_id = $1 and contact_id = $3
           )
         )
       )
     order by created_at desc
     limit 40`,
    [tenantId, "contact", contactId, "lead"],
  );

  return result.rows.map(mapActivity);
}

export async function listContactOpportunities(
  db: DbClient,
  tenantId: string,
  contactId: string,
) {
  const result = await db.query<OpportunityRow>(
    `select opportunities.*, pipeline_stages.name as stage_name
     from opportunities
     join pipeline_stages on pipeline_stages.id = opportunities.stage_id
     where opportunities.tenant_id = $1 and opportunities.contact_id = $2
     order by opportunities.updated_at desc`,
    [tenantId, contactId],
  );

  return result.rows.map(mapOpportunity);
}

export async function findFormSubmissionByIdempotency(
  db: DbClient,
  tenantId: string,
  idempotencyKey: string,
) {
  const existing = await db.query<{ id: string }>(
    "select id from form_submissions where tenant_id = $1 and idempotency_key = $2",
    [tenantId, idempotencyKey],
  );

  return existing.rows[0] ?? null;
}

export async function insertFormSubmission(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    websiteId: string;
    payload: string;
    contactId: string;
    idempotencyKey: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into form_submissions (id, tenant_id, form_id, website_id, payload, created_contact_id, idempotency_key, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.id,
      input.tenantId,
      null,
      input.websiteId,
      input.payload,
      input.contactId,
      input.idempotencyKey,
      input.createdAt,
    ],
  );
}

export async function findContactByEmail(
  db: DbClient,
  tenantId: string,
  email: string,
) {
  const existing = await db.query<{ id: string }>(
    "select id from contacts where tenant_id = $1 and email = $2",
    [tenantId, email],
  );

  return existing.rows[0] ?? null;
}

export async function updateContactFromLead(
  db: DbClient,
  input: {
    tenantId: string;
    contactId: string;
    name: string;
    phone: string;
    source: string;
    updatedAt: string;
  },
) {
  await db.query(
    "update contacts set name = $1, phone = $2, status = $3, source = $4, updated_at = $5 where tenant_id = $6 and id = $7",
    [
      input.name,
      input.phone,
      "A qualifier",
      input.source,
      input.updatedAt,
      input.tenantId,
      input.contactId,
    ],
  );
}

export async function insertContactFromLead(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    name: string;
    email: string;
    phone: string;
    source: string;
    tags: string;
    ownerId: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into contacts (id, tenant_id, name, email, phone, status, source, tags, assigned_user_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.id,
      input.tenantId,
      input.name,
      input.email,
      input.phone,
      "Nouveau",
      input.source,
      input.tags,
      input.ownerId,
      input.createdAt,
      input.createdAt,
    ],
  );
}

export async function insertLead(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    contactId: string;
    source: string;
    pagePath: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into leads (id, tenant_id, contact_id, source, status, opportunity_value, page_path, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.id,
      input.tenantId,
      input.contactId,
      input.source,
      "Nouveau contact",
      0,
      input.pagePath,
      input.createdAt,
    ],
  );
}

export async function findFirstPipelineStage(db: DbClient, tenantId: string) {
  const stage = await db.query<{ id: string }>(
    "select id from pipeline_stages where tenant_id = $1 order by position asc limit 1",
    [tenantId],
  );

  return stage.rows[0] ?? null;
}

export async function insertOpportunity(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    contactId: string;
    stageId: string;
    nextFollowUpAt: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into opportunities (id, tenant_id, contact_id, stage_id, value_cents, next_follow_up_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.id,
      input.tenantId,
      input.contactId,
      input.stageId,
      0,
      input.nextFollowUpAt,
      input.createdAt,
      input.createdAt,
    ],
  );
}

export async function insertActivity(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    type: string;
    summary: string;
    targetType: string;
    targetId: string;
    createdAt: string;
  },
) {
  await db.query(
    "insert into activities (id, tenant_id, type, summary, target_type, target_id, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [
      input.id,
      input.tenantId,
      input.type,
      input.summary,
      input.targetType,
      input.targetId,
      input.createdAt,
    ],
  );
}

function mapContact(row: ContactRow): Contact {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    source: row.source,
    tags: safeJson<string[]>(row.tags, []),
    assignedUserId: row.assigned_user_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLead(row: LeadRow): Lead {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    source: row.source,
    status: row.status,
    opportunityValue: row.opportunity_value,
    pagePath: row.page_path,
    createdAt: row.created_at,
  };
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    status: row.status,
    assignedUserId: row.assigned_user_id,
    dueAt: row.due_at,
    relatedType: row.related_type,
    relatedId: row.related_id,
    createdAt: row.created_at,
  };
}

function mapActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    summary: row.summary,
    targetType: row.target_type,
    targetId: row.target_id,
    createdAt: row.created_at,
  };
}

function mapNote(row: NoteRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    body: row.body,
    targetType: row.target_type,
    targetId: row.target_id,
    createdAt: row.created_at,
  };
}

function mapContactConsent(row: ContactConsentRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    marketingOptIn: row.marketing_opt_in === 1,
    privacyNoticeAcceptedAt: row.privacy_notice_accepted_at ?? undefined,
    dataRetentionUntil: row.data_retention_until ?? undefined,
  };
}

function mapOpportunity(row: OpportunityRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    stageId: row.stage_id,
    stageName: row.stage_name,
    valueCents: row.value_cents,
    nextFollowUpAt: row.next_follow_up_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
