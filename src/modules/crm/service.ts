import type { DbClient } from "@/lib/db";
import { id, nowIso, toJson } from "@/lib/security";
import type { Role } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import { CrmError } from "@/modules/crm/errors";
import {
  completeTask,
  findContactById,
  findContactConsent,
  findContactTaskById,
  findOpportunityById,
  findPipelineStageById,
  insertActivity,
  insertContactConsent,
  insertContactNote,
  insertContactTask,
  listActivities,
  listContactActivities,
  listContactNotes,
  listContactOpportunities,
  listContactTasks,
  listContacts,
  listLeads,
  listOpportunities,
  listPipelineStages,
  listTasks,
  updateContact,
  updateContactConsent,
  updateOpportunityRecord,
} from "@/modules/crm/repository";
import {
  completeTaskSchema,
  contactConsentSchema,
  contactNoteSchema,
  contactTaskSchema,
  contactUpdateSchema,
  opportunityFiltersSchema,
  opportunityLookupSchema,
  opportunityUpdateSchema,
  tenantContactLookupSchema,
  type CompleteTaskInput,
  type ContactConsentInput,
  type ContactNoteInput,
  type ContactTaskInput,
  type ContactUpdateInput,
  type OpportunityFiltersInput,
  type OpportunityUpdateInput,
} from "@/modules/crm/schemas";
import { assertTenantAccess } from "@/modules/tenants";

const crmWriteRoles: Role[] = [
  "owner",
  "administrator",
  "manager",
  "collaborator",
];

export async function getCrm(db: DbClient, userId: string, tenantId: string) {
  await assertTenantAccess(db, userId, tenantId);
  const [contacts, leads, tasks, activities] = await Promise.all([
    listContacts(db, tenantId),
    listLeads(db, tenantId),
    listTasks(db, tenantId),
    listActivities(db, tenantId, 20),
  ]);

  return {
    contacts,
    leads,
    tasks,
    activities,
  };
}

export async function getTenantActivities(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  return listActivities(db, tenantId, limit);
}

export async function findContactForTenant(
  db: DbClient,
  userId: string,
  tenantId: string,
  contactId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const parsed = tenantContactLookupSchema.parse({ contactId });

  return findContactById(db, tenantId, parsed.contactId);
}

export async function getContactDetail(
  db: DbClient,
  userId: string,
  tenantId: string,
  contactId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const parsed = tenantContactLookupSchema.parse({ contactId });
  const contact = await findContactById(db, tenantId, parsed.contactId);

  if (!contact) {
    return null;
  }

  const [notes, consent, tasks, activities, opportunities] = await Promise.all([
    listContactNotes(db, tenantId, contact.id),
    findContactConsent(db, tenantId, contact.id),
    listContactTasks(db, tenantId, contact.id),
    listContactActivities(db, tenantId, contact.id),
    listContactOpportunities(db, tenantId, contact.id),
  ]);

  return {
    contact,
    notes,
    consent,
    tasks,
    activities,
    opportunities,
  };
}

export async function updateContactProfile(
  db: DbClient,
  userId: string,
  tenantId: string,
  contactId: string,
  input: ContactUpdateInput,
) {
  await assertTenantAccess(db, userId, tenantId, crmWriteRoles);
  const parsedContactId = tenantContactLookupSchema.parse({ contactId }).contactId;
  const parsed = contactUpdateSchema.parse(input);
  const existing = await ensureContact(db, tenantId, parsedContactId);
  const assignedUserId = parsed.assignedUserId ?? null;

  if (assignedUserId) {
    await assertTenantAccess(db, assignedUserId, tenantId);
  }

  const updated = await updateContact(db, {
    tenantId,
    contactId: existing.id,
    name: parsed.name,
    phone: parsed.phone,
    status: parsed.status,
    tags: toJson(normalizeTags(parsed.tags)),
    assignedUserId,
    updatedAt: nowIso(),
  });

  if (!updated) {
    throw new CrmError("contact_not_found", "Contact introuvable.");
  }

  await insertActivity(db, {
    id: id("activity"),
    tenantId,
    type: "contact.updated",
    summary: "Contact mis a jour.",
    targetType: "contact",
    targetId: updated.id,
    createdAt: nowIso(),
  });
  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "contact.updated",
    targetType: "contact",
    targetId: updated.id,
    metadata: {
      previousStatus: existing.status,
      status: updated.status,
      assignedUserId,
    },
  });

  return updated;
}

export async function upsertContactConsent(
  db: DbClient,
  userId: string,
  tenantId: string,
  contactId: string,
  input: ContactConsentInput,
) {
  await assertTenantAccess(db, userId, tenantId, crmWriteRoles);
  const parsedContactId = tenantContactLookupSchema.parse({ contactId }).contactId;
  await ensureContact(db, tenantId, parsedContactId);
  const parsed = contactConsentSchema.parse(input);
  const existing = await findContactConsent(db, tenantId, parsedContactId);
  const now = nowIso();
  const privacyNoticeAcceptedAt = parsed.privacyNoticeAccepted
    ? existing?.privacyNoticeAcceptedAt ?? now
    : null;
  const dataRetentionUntil = parsed.dataRetentionUntil || null;

  if (existing) {
    await updateContactConsent(db, {
      tenantId,
      consentId: existing.id,
      marketingOptIn: parsed.marketingOptIn,
      privacyNoticeAcceptedAt,
      dataRetentionUntil,
    });
  } else {
    await insertContactConsent(db, {
      id: id("consent"),
      tenantId,
      contactId: parsedContactId,
      marketingOptIn: parsed.marketingOptIn,
      privacyNoticeAcceptedAt,
      dataRetentionUntil,
    });
  }

  await insertActivity(db, {
    id: id("activity"),
    tenantId,
    type: "contact.consent_updated",
    summary: "Consentement du contact mis a jour.",
    targetType: "contact",
    targetId: parsedContactId,
    createdAt: now,
  });
  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "contact.consent_updated",
    targetType: "contact",
    targetId: parsedContactId,
    metadata: {
      marketingOptIn: parsed.marketingOptIn,
      privacyNoticeAccepted: parsed.privacyNoticeAccepted,
    },
  });

  return findContactConsent(db, tenantId, parsedContactId);
}

export async function addContactNote(
  db: DbClient,
  userId: string,
  tenantId: string,
  contactId: string,
  input: ContactNoteInput,
) {
  await assertTenantAccess(db, userId, tenantId, crmWriteRoles);
  const parsedContactId = tenantContactLookupSchema.parse({ contactId }).contactId;
  await ensureContact(db, tenantId, parsedContactId);
  const parsed = contactNoteSchema.parse(input);
  const now = nowIso();
  const noteId = id("note");

  await insertContactNote(db, {
    id: noteId,
    tenantId,
    contactId: parsedContactId,
    body: parsed.body,
    createdAt: now,
  });
  await insertActivity(db, {
    id: id("activity"),
    tenantId,
    type: "contact.note_created",
    summary: "Note ajoutee au contact.",
    targetType: "contact",
    targetId: parsedContactId,
    createdAt: now,
  });
  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "contact.note_created",
    targetType: "note",
    targetId: noteId,
    metadata: { contactId: parsedContactId },
  });

  return noteId;
}

export async function createContactTask(
  db: DbClient,
  userId: string,
  tenantId: string,
  contactId: string,
  input: ContactTaskInput,
) {
  await assertTenantAccess(db, userId, tenantId, crmWriteRoles);
  const parsedContactId = tenantContactLookupSchema.parse({ contactId }).contactId;
  await ensureContact(db, tenantId, parsedContactId);
  const parsed = contactTaskSchema.parse(input);
  const assignedUserId = parsed.assignedUserId || userId;
  await assertTenantAccess(db, assignedUserId, tenantId);

  const now = nowIso();
  const taskId = id("task");
  await insertContactTask(db, {
    id: taskId,
    tenantId,
    contactId: parsedContactId,
    title: parsed.title,
    assignedUserId,
    dueAt: new Date(parsed.dueAt).toISOString(),
    createdAt: now,
  });
  await insertActivity(db, {
    id: id("activity"),
    tenantId,
    type: "task.created",
    summary: `Tache creee : ${parsed.title}`,
    targetType: "contact",
    targetId: parsedContactId,
    createdAt: now,
  });
  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "task.created",
    targetType: "task",
    targetId: taskId,
    metadata: { contactId: parsedContactId, assignedUserId },
  });

  return taskId;
}

export async function completeContactTask(
  db: DbClient,
  userId: string,
  tenantId: string,
  contactId: string,
  input: CompleteTaskInput,
) {
  await assertTenantAccess(db, userId, tenantId, crmWriteRoles);
  const parsedContactId = tenantContactLookupSchema.parse({ contactId }).contactId;
  await ensureContact(db, tenantId, parsedContactId);
  const parsed = completeTaskSchema.parse(input);
  const task = await findContactTaskById(
    db,
    tenantId,
    parsedContactId,
    parsed.taskId,
  );

  if (!task) {
    throw new CrmError("task_not_found", "Tache introuvable.");
  }

  await completeTask(db, tenantId, task.id);
  await insertActivity(db, {
    id: id("activity"),
    tenantId,
    type: "task.completed",
    summary: `Tache terminee : ${task.title}`,
    targetType: "contact",
    targetId: parsedContactId,
    createdAt: nowIso(),
  });
  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "task.completed",
    targetType: "task",
    targetId: task.id,
    metadata: { contactId: parsedContactId },
  });
}

export async function getOpportunities(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: OpportunityFiltersInput = {},
) {
  await assertTenantAccess(db, userId, tenantId);
  const parsed = opportunityFiltersSchema.parse(input);
  const filters = {
    search: parsed.search?.trim() || undefined,
    stageId: parsed.stageId?.trim() || undefined,
  };
  const [stages, opportunities] = await Promise.all([
    listPipelineStages(db, tenantId),
    listOpportunities(db, tenantId, filters),
  ]);

  return { stages, opportunities };
}

export async function getOpportunityDetail(
  db: DbClient,
  userId: string,
  tenantId: string,
  opportunityId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const parsed = opportunityLookupSchema.parse({ opportunityId });
  const [opportunity, stages] = await Promise.all([
    findOpportunityById(db, tenantId, parsed.opportunityId),
    listPipelineStages(db, tenantId),
  ]);

  if (!opportunity) {
    return null;
  }

  return { opportunity, stages };
}

export async function updateOpportunity(
  db: DbClient,
  userId: string,
  tenantId: string,
  opportunityId: string,
  input: OpportunityUpdateInput,
) {
  await assertTenantAccess(db, userId, tenantId, crmWriteRoles);
  const parsedOpportunityId = opportunityLookupSchema.parse({
    opportunityId,
  }).opportunityId;
  const parsed = opportunityUpdateSchema.parse(input);
  const [existing, stage] = await Promise.all([
    findOpportunityById(db, tenantId, parsedOpportunityId),
    findPipelineStageById(db, tenantId, parsed.stageId),
  ]);

  if (!existing) {
    throw new CrmError("opportunity_not_found", "Opportunite introuvable.");
  }

  if (!stage) {
    throw new CrmError("stage_not_found", "Etape de pipeline introuvable.");
  }

  const updated = await updateOpportunityRecord(db, {
    tenantId,
    opportunityId: existing.id,
    stageId: stage.id,
    valueCents: parsed.valueCents,
    nextFollowUpAt: parsed.nextFollowUpAt
      ? new Date(parsed.nextFollowUpAt).toISOString()
      : null,
    lostReason: parsed.lostReason?.trim() || null,
    updatedAt: nowIso(),
  });

  if (!updated) {
    throw new CrmError("opportunity_not_found", "Opportunite introuvable.");
  }

  await insertActivity(db, {
    id: id("activity"),
    tenantId,
    type: "opportunity.updated",
    summary: `Opportunite deplacee vers ${stage.name}.`,
    targetType: "opportunity",
    targetId: updated.id,
    createdAt: nowIso(),
  });
  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "opportunity.updated",
    targetType: "opportunity",
    targetId: updated.id,
    metadata: {
      previousStageId: existing.stageId,
      stageId: stage.id,
      valueCents: parsed.valueCents,
      hasLostReason: Boolean(parsed.lostReason?.trim()),
    },
  });

  return updated;
}

async function ensureContact(
  db: DbClient,
  tenantId: string,
  contactId: string,
) {
  const contact = await findContactById(db, tenantId, contactId);

  if (!contact) {
    throw new CrmError("contact_not_found", "Contact introuvable.");
  }

  return contact;
}

function normalizeTags(tags: string[]) {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
}
