import { getDatabaseUrl } from "@/db/client";
import { withTenantTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso, toJson } from "@/lib/security";
import type { Contact, Role } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import { CrmError } from "@/modules/crm/errors";
import {
  completeTask,
  deleteMergedContact,
  findContactById,
  findContactConsent,
  findContactMergeRecordByMergedContactId,
  findContactTaskById,
  findOpportunityById,
  findPipelineStageById,
  insertContactMergeRecord,
  insertActivity,
  insertContactConsent,
  insertContactNote,
  insertContactTask,
  listActivities,
  listContactActivities,
  listContactNotes,
  listContactOpportunities,
  listContactTasks,
  listContactsForDuplicateReview,
  listContacts,
  listLeads,
  listOpportunities,
  listPipelineStages,
  listTasks,
  mergeContactConsents,
  reassignMergedContactReferences,
  updateContact,
  updateContactConsent,
  updateMergedContactSurvivor,
  updateOpportunityRecord,
} from "@/modules/crm/repository";
import {
  completeTaskSchema,
  contactMergeSchema,
  contactConsentSchema,
  contactNoteSchema,
  contactTaskSchema,
  contactUpdateSchema,
  duplicatePairSchema,
  opportunityFiltersSchema,
  opportunityLookupSchema,
  opportunityUpdateSchema,
  tenantContactLookupSchema,
  type ContactMergeInput,
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
const crmMergeRoles: Role[] = ["owner", "administrator", "manager"];
const mergeableContactFields = [
  "name",
  "email",
  "phone",
  "status",
  "source",
  "assignedUserId",
] as const;

type MergeableContactField = (typeof mergeableContactFields)[number];
type MergeFieldSource = "survivor" | "merged";
type DuplicateReasonKey =
  | "email"
  | "phone"
  | "name_email"
  | "name_phone"
  | "company_name";

type DuplicateReason = {
  key: DuplicateReasonKey;
  label: string;
};
type DuplicateCandidate = {
  id: string;
  tenantId: string;
  left: Contact;
  right: Contact;
  reasons: DuplicateReason[];
  score: number;
  actionHref: string;
};

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

export async function getContactDuplicateCandidates(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const contacts = await listContactsForDuplicateReview(db, tenantId);

  return buildDuplicateCandidates(contacts);
}

export async function getDuplicatePairDetail(
  db: DbClient,
  userId: string,
  tenantId: string,
  leftContactId: string,
  rightContactId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const parsed = duplicatePairSchema.parse({ leftContactId, rightContactId });

  if (parsed.leftContactId === parsed.rightContactId) {
    throw new CrmError(
      "duplicate_merge_invalid",
      "Impossible de fusionner un contact avec lui-meme.",
    );
  }

  const [left, right] = await Promise.all([
    findContactById(db, tenantId, parsed.leftContactId),
    findContactById(db, tenantId, parsed.rightContactId),
  ]);

  if (!left || !right) {
    throw new CrmError("contact_not_found", "Contact introuvable.");
  }

  const reasons = detectDuplicateReasons(left, right);
  if (reasons.length === 0) {
    throw new CrmError(
      "duplicate_pair_not_found",
      "Aucun doublon probable n'a ete detecte pour ces contacts.",
    );
  }

  return {
    id: duplicateCandidateId(left, right),
    left,
    right,
    reasons,
    defaultFieldSources: defaultFieldSources(left, right),
    preview: previewMerge(left, right, defaultFieldSources(left, right)),
  };
}

export async function mergeContacts(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: ContactMergeInput,
) {
  await assertTenantAccess(db, userId, tenantId, crmMergeRoles);
  const parsed = contactMergeSchema.parse(input);

  if (parsed.survivorContactId === parsed.mergedContactId) {
    throw new CrmError(
      "duplicate_merge_invalid",
      "Impossible de fusionner un contact avec lui-meme.",
    );
  }

  const alreadyMerged = await findContactMergeRecordByMergedContactId(
    db,
    tenantId,
    parsed.mergedContactId,
  );
  if (alreadyMerged) {
    return alreadyMerged;
  }

  return runTenantAwareTransaction(db, tenantId, userId, async (tx) => {
    const existingRecord = await findContactMergeRecordByMergedContactId(
      tx,
      tenantId,
      parsed.mergedContactId,
    );
    if (existingRecord) {
      return existingRecord;
    }

    const survivor = await findContactById(
      tx,
      tenantId,
      parsed.survivorContactId,
    );
    const merged = await findContactById(tx, tenantId, parsed.mergedContactId);

    if (!survivor || !merged) {
      throw new CrmError("contact_not_found", "Contact introuvable.");
    }

    const reasons = detectDuplicateReasons(survivor, merged);
    if (reasons.length === 0) {
      throw new CrmError(
        "duplicate_pair_not_found",
        "Aucun doublon probable n'a ete detecte pour ces contacts.",
      );
    }

    const selectedFields = {
      ...defaultFieldSources(survivor, merged),
      ...parsed.fieldSources,
    };
    const mergedFields = previewMerge(survivor, merged, selectedFields);

    if (mergedFields.assignedUserId) {
      await assertTenantAccess(tx, mergedFields.assignedUserId, tenantId);
    }

    const now = nowIso();
    await reassignMergedContactReferences(tx, {
      tenantId,
      survivorContactId: survivor.id,
      mergedContactId: merged.id,
      updatedAt: now,
    });
    await mergeContactConsents(tx, {
      tenantId,
      survivorContactId: survivor.id,
      mergedContactId: merged.id,
    });
    await deleteMergedContact(tx, tenantId, merged.id);

    const updatedSurvivor = await updateMergedContactSurvivor(tx, {
      tenantId,
      contactId: survivor.id,
      name: mergedFields.name,
      email: mergedFields.email,
      phone: mergedFields.phone,
      status: mergedFields.status,
      source: mergedFields.source,
      tags: toJson(mergeTags(survivor.tags, merged.tags)),
      assignedUserId: mergedFields.assignedUserId,
      updatedAt: now,
    });

    if (!updatedSurvivor) {
      throw new CrmError("contact_not_found", "Contact survivant introuvable.");
    }

    const mergeRecordId = id("merge");
    const mergeRecord =
      (await insertContactMergeRecord(tx, {
        id: mergeRecordId,
        tenantId,
        survivorContactId: survivor.id,
        mergedContactId: merged.id,
        reason: parsed.reason.trim(),
        selectedFields: toJson(selectedFields),
        mergedSnapshot: toJson({
          reasons: reasons.map((reason) => reason.key),
          survivorBefore: survivor,
          mergedBefore: merged,
          survivorAfter: updatedSurvivor,
        }),
        createdBy: userId,
        createdAt: now,
      })) ??
      (await findContactMergeRecordByMergedContactId(tx, tenantId, merged.id));

    if (!mergeRecord) {
      throw new CrmError(
        "contact_already_merged",
        "Cette fusion a deja ete executee.",
      );
    }

    await insertActivity(tx, {
      id: id("activity"),
      tenantId,
      type: "contact.merged",
      summary: `Doublon fusionne dans ${updatedSurvivor.name}.`,
      targetType: "contact",
      targetId: updatedSurvivor.id,
      createdAt: now,
    });
    await recordAuditLog(tx, {
      tenantId,
      actorId: userId,
      action: "contact.merged",
      targetType: "contact_merge",
      targetId: mergeRecord.id,
      metadata: {
        survivorContactId: survivor.id,
        mergedContactId: merged.id,
        reasons: reasons.map((reason) => reason.key),
      },
    });

    return mergeRecord;
  });
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

function buildDuplicateCandidates(contacts: Contact[]) {
  const candidates: DuplicateCandidate[] = [];

  for (let leftIndex = 0; leftIndex < contacts.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < contacts.length;
      rightIndex += 1
    ) {
      const leftContact = contacts[leftIndex]!;
      const rightContact = contacts[rightIndex]!;
      const reasons = detectDuplicateReasons(leftContact, rightContact);

      if (reasons.length === 0) {
        continue;
      }

      const [left, right] = [leftContact, rightContact].sort((a, b) =>
        a.id.localeCompare(b.id),
      );

      candidates.push({
        id: duplicateCandidateId(left, right),
        tenantId: left.tenantId,
        left,
        right,
        reasons,
        score: reasons.reduce(
          (total, reason) => total + duplicateReasonScore(reason.key),
          0,
        ),
        actionHref: `/contacts/doublons/${left.id}/${right.id}`,
      });
    }
  }

  return candidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.id.localeCompare(b.id);
  });
}

function detectDuplicateReasons(left: Contact, right: Contact) {
  const reasons: DuplicateReason[] = [];
  const leftEmail = normalizeEmail(left.email);
  const rightEmail = normalizeEmail(right.email);
  const leftPhone = normalizePhone(left.phone);
  const rightPhone = normalizePhone(right.phone);
  const leftName = normalizeName(left.name);
  const rightName = normalizeName(right.name);

  if (leftEmail && leftEmail === rightEmail) {
    reasons.push({ key: "email", label: "Email identique" });
  }

  if (leftPhone.length >= 6 && leftPhone === rightPhone) {
    reasons.push({ key: "phone", label: "Telephone identique" });
  }

  if (leftName && leftName === rightName && leftEmail && leftEmail === rightEmail) {
    reasons.push({ key: "name_email", label: "Nom et email concordants" });
  }

  if (leftName && leftName === rightName && leftPhone && leftPhone === rightPhone) {
    reasons.push({ key: "name_phone", label: "Nom et telephone concordants" });
  }

  if (
    leftName &&
    leftName === rightName &&
    looksLikeCompanyName(left.name) &&
    looksLikeCompanyName(right.name)
  ) {
    reasons.push({ key: "company_name", label: "Nom d'entreprise concordant" });
  }

  return reasons;
}

function duplicateCandidateId(left: Contact, right: Contact) {
  return `dup_${[left.id, right.id].sort().join("_")}`;
}

function duplicateReasonScore(reason: DuplicateReasonKey) {
  switch (reason) {
    case "email":
      return 70;
    case "phone":
      return 60;
    case "name_email":
    case "name_phone":
      return 25;
    case "company_name":
      return 15;
  }
}

function defaultFieldSources(
  survivor: Contact,
  merged: Contact,
): Record<MergeableContactField, MergeFieldSource> {
  return Object.fromEntries(
    mergeableContactFields.map((field) => [
      field,
      shouldPreferMergedField(survivor, merged, field) ? "merged" : "survivor",
    ]),
  ) as Record<MergeableContactField, MergeFieldSource>;
}

function shouldPreferMergedField(
  survivor: Contact,
  merged: Contact,
  field: MergeableContactField,
) {
  const survivorValue = getContactFieldValue(survivor, field);
  const mergedValue = getContactFieldValue(merged, field);

  if (!hasValue(survivorValue) && hasValue(mergedValue)) {
    return true;
  }

  if (!hasValue(mergedValue)) {
    return false;
  }

  return (
    survivorValue !== mergedValue &&
    Date.parse(merged.updatedAt) > Date.parse(survivor.updatedAt)
  );
}

function previewMerge(
  survivor: Contact,
  merged: Contact,
  fieldSources: Partial<Record<MergeableContactField, MergeFieldSource>>,
) {
  return {
    name: chooseMergedField(survivor, merged, "name", fieldSources),
    email: chooseMergedField(survivor, merged, "email", fieldSources),
    phone: chooseMergedField(survivor, merged, "phone", fieldSources),
    status: chooseMergedField(survivor, merged, "status", fieldSources),
    source: chooseMergedField(survivor, merged, "source", fieldSources),
    assignedUserId:
      chooseMergedField(survivor, merged, "assignedUserId", fieldSources) || null,
  };
}

function chooseMergedField(
  survivor: Contact,
  merged: Contact,
  field: MergeableContactField,
  fieldSources: Partial<Record<MergeableContactField, MergeFieldSource>>,
) {
  const source = fieldSources[field] ?? "survivor";
  const selected = getContactFieldValue(
    source === "merged" ? merged : survivor,
    field,
  );
  const fallback = getContactFieldValue(
    source === "merged" ? survivor : merged,
    field,
  );

  return hasValue(selected) ? selected : fallback;
}

function getContactFieldValue(contact: Contact, field: MergeableContactField) {
  if (field === "assignedUserId") {
    return contact.assignedUserId ?? "";
  }

  return contact[field];
}

function hasValue(value: string | undefined | null) {
  return Boolean(value?.trim());
}

function mergeTags(survivorTags: string[], mergedTags: string[]) {
  return normalizeTags([...survivorTags, ...mergedTags]);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  const withoutInternationalPrefix = digits.startsWith("00")
    ? digits.slice(2)
    : digits;

  return withoutInternationalPrefix.length > 8
    ? withoutInternationalPrefix.slice(-9)
    : withoutInternationalPrefix;
}

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeCompanyName(value: string) {
  const normalized = normalizeName(value);
  return /\b(sarl|sas|eurl|garage|auto|atelier|cabinet|societe|entreprise)\b/.test(
    normalized,
  );
}

async function runTenantAwareTransaction<T>(
  db: DbClient,
  tenantId: string,
  actorId: string,
  callback: (client: DbClient) => Promise<T>,
) {
  if (getDatabaseUrl() && isPostgresClient(db)) {
    return withTenantTransaction(tenantId, actorId, callback);
  }

  await db.query("begin");
  try {
    const result = await callback(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

function isPostgresClient(db: DbClient) {
  return (db as DbClient & { __runtime?: string }).__runtime === "postgres";
}
