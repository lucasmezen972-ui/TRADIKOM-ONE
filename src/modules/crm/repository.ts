import type { DbClient } from "@/lib/db";

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
