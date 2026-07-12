import type { DbClient } from "@/lib/db";
import {
  correlationId,
  daysFromNow,
  id,
  nowIso,
  secureToken,
  toJson,
} from "@/lib/security";
import type { Tenant, Website } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import { CrmError } from "@/modules/crm/errors";
import {
  findContactByEmail,
  findFirstPipelineStage,
  findFormSubmissionByIdempotency,
  insertActivity,
  insertContactFromLead,
  insertFormSubmission,
  insertLead,
  insertOpportunity,
  updateContactFromLead,
} from "@/modules/crm/repository";
import {
  leadIngestionSchema,
  publicLeadSchema,
  type LeadIngestionInput,
  type PublicLeadInput,
} from "@/modules/crm/schemas";
import { getTenantOwnerId } from "@/modules/tenants";
import { enqueueLeadFollowUpWorkflow } from "@/modules/workflows/engine";
import { enforceRateLimit, rateLimitPolicies } from "@/modules/rate-limit";

export type PublishedSiteLookup = {
  tenant: Tenant;
  website: Website;
};

export async function submitPublicLead(
  db: DbClient,
  slug: string,
  payload: PublicLeadInput,
  dependencies: {
    getPublishedSite: (
      db: DbClient,
      slug: string,
    ) => Promise<PublishedSiteLookup | null>;
  },
) {
  const parsed = publicLeadSchema.parse(payload);
  const site = await dependencies.getPublishedSite(db, slug);
  if (!site) {
    throw new CrmError(
      "published_site_not_found",
      "Site introuvable ou non publie.",
    );
  }

  const websiteId = site.website.id;
  const tenantId = site.tenant.id;
  const idempotencyKey = parsed.idempotencyKey || secureToken();
  const existing = await findFormSubmissionByIdempotency(
    db,
    tenantId,
    idempotencyKey,
  );

  if (existing) {
    return existing.id;
  }

  await enforceRateLimit(db, {
    operationKey: "public_form.submit",
    subjectKey: parsed.email.toLowerCase(),
    scopeKey: tenantId,
    limit: rateLimitPolicies.publicForm.limit,
    windowSeconds: rateLimitPolicies.publicForm.windowSeconds,
  });

  const result = await createLeadFromPayload(db, tenantId, {
    name: parsed.name,
    email: parsed.email,
    phone: parsed.phone,
    message: parsed.message,
    source: "website",
    pagePath: `/sites/${slug}`,
    websiteId,
  });

  await insertFormSubmission(db, {
    id: id("submission"),
    tenantId,
    websiteId,
    payload: toJson(parsed),
    contactId: result.contactId,
    idempotencyKey,
    createdAt: nowIso(),
  });
  await recordAuditLog(db, {
    tenantId,
    actorId: "system",
    action: "form.submitted",
    targetType: "website",
    targetId: websiteId,
    metadata: { source: "website" },
  });

  return result.leadId;
}

export async function createLeadFromPayload(
  db: DbClient,
  tenantId: string,
  input: LeadIngestionInput,
) {
  const payload = leadIngestionSchema.parse(input);
  const now = nowIso();
  const normalizedEmail = payload.email.toLowerCase();
  const ownerId = await getTenantOwnerId(db, tenantId);
  let contactId: string;
  const existing = await findContactByEmail(db, tenantId, normalizedEmail);

  if (existing) {
    contactId = existing.id;
    await updateContactFromLead(db, {
      tenantId,
      contactId,
      name: payload.name,
      phone: payload.phone,
      source: payload.source,
      updatedAt: now,
    });
  } else {
    contactId = id("contact");
    await insertContactFromLead(db, {
      id: contactId,
      tenantId,
      name: payload.name,
      email: normalizedEmail,
      phone: payload.phone,
      source: payload.source,
      tags: toJson([payload.source]),
      ownerId,
      createdAt: now,
    });
    await recordAuditLog(db, {
      tenantId,
      actorId: "system",
      action: "contact.created",
      targetType: "contact",
      targetId: contactId,
      metadata: { source: payload.source },
    });
  }

  const leadId = id("lead");
  await insertLead(db, {
    id: leadId,
    tenantId,
    contactId,
    source: payload.source,
    pagePath: payload.pagePath,
    createdAt: now,
  });

  const stage = await findFirstPipelineStage(db, tenantId);
  if (stage) {
    await insertOpportunity(db, {
      id: id("opp"),
      tenantId,
      contactId,
      stageId: stage.id,
      nextFollowUpAt: daysFromNow(1),
      createdAt: now,
    });
  }

  await insertActivity(db, {
    id: id("activity"),
    tenantId,
    type: "lead.created",
    summary: `Nouveau lead recu depuis ${payload.source}`,
    targetType: "lead",
    targetId: leadId,
    createdAt: now,
  });
  await recordAuditLog(db, {
    tenantId,
    actorId: "system",
    action: "lead.created",
    targetType: "lead",
    targetId: leadId,
    metadata: { source: payload.source },
  });
  await runDefaultLeadWorkflow(db, tenantId, leadId, contactId, ownerId, payload.source);

  return { leadId, contactId };
}

async function runDefaultLeadWorkflow(
  db: DbClient,
  tenantId: string,
  leadId: string,
  contactId: string,
  ownerId: string,
  source: string,
) {
  const eventId = await enqueueLeadFollowUpWorkflow(db, {
    tenantId,
    leadId,
    contactId,
    ownerId,
    source,
    correlationId: correlationId(),
  });

  if (eventId) {
    await recordAuditLog(db, {
      tenantId,
      actorId: "system",
      action: "workflow.enqueued",
      targetType: "domain_event",
      targetId: eventId,
      metadata: { leadId },
    });
  }
}
