import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso, safeJson } from "@/lib/security";
import type { BusinessProfile } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import { BusinessBrainError } from "@/modules/business-brain/errors";
import {
  archiveBusinessBrainEntry as archiveBusinessBrainEntryRecord,
  findActiveBusinessBrainEntry,
  getBusinessBrainSignals,
  insertBusinessBrainEntry,
  insertBusinessBrainEvidence,
  listActiveBusinessBrainEntries,
  listActiveBusinessBrainEvidence,
  supersedeBusinessBrainEntry,
  type BusinessBrainEntryRow,
} from "@/modules/business-brain/repository";
import {
  archiveBusinessBrainEntrySchema,
  businessBrainDomainSchema,
  createBusinessBrainEntrySchema,
  reviseBusinessBrainEntrySchema,
  type BusinessBrainDomain,
  type CreateBusinessBrainEntryInput,
  type ReviseBusinessBrainEntryInput,
} from "@/modules/business-brain/schemas";
import { assertTenantAccess } from "@/modules/tenants";

const writableRoles = [
  "owner",
  "administrator",
  "manager",
  "collaborator",
] as const;

export async function getBusinessBrain(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const [rows, evidenceRows, rawSignals] = await Promise.all([
    listActiveBusinessBrainEntries(db, tenantId),
    listActiveBusinessBrainEvidence(db, tenantId),
    getBusinessBrainSignals(db, tenantId),
  ]);

  if (!rawSignals) {
    throw new BusinessBrainError(
      "business_brain_unavailable",
      "La mémoire de l'entreprise est indisponible.",
    );
  }

  const evidenceByEntry = new Map<
    string,
    Array<{
      id: string;
      type: (typeof evidenceRows)[number]["evidence_type"];
      sourceRef?: string;
      summary: string;
      capturedAt: string;
    }>
  >();
  for (const evidence of evidenceRows) {
    const current = evidenceByEntry.get(evidence.entry_id) ?? [];
    current.push({
      id: evidence.id,
      type: evidence.evidence_type,
      sourceRef: evidence.source_ref ?? undefined,
      summary: evidence.summary,
      capturedAt: evidence.captured_at,
    });
    evidenceByEntry.set(evidence.entry_id, current);
  }

  const entries = rows.map((row) => ({
    ...mapEntry(row),
    evidence: evidenceByEntry.get(row.id) ?? [],
  }));
  const profile = safeJson<BusinessProfile | null>(
    rawSignals.business_profile_data,
    null,
  );
  const signals = {
    profileUpdatedAt: rawSignals.business_profile_updated_at,
    contacts: Number(rawSignals.contact_count),
    opportunities: Number(rawSignals.opportunity_count),
    pipelineValueCents: Number(rawSignals.pipeline_value_cents),
    members: Number(rawSignals.member_count),
    activeWorkflows: Number(rawSignals.workflow_count),
    websites: Number(rawSignals.website_count),
    publishedWebsites: Number(rawSignals.published_website_count),
    connectors: Number(rawSignals.connector_count),
    apiAssets: Number(rawSignals.api_asset_count),
  };

  return {
    entries,
    signals,
    coverage: buildCoverage(profile, entries, signals),
  };
}

export async function createBusinessBrainEntry(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: CreateBusinessBrainEntryInput,
) {
  const parsed = createBusinessBrainEntrySchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...writableRoles]);
    const entryId = id("brain_entry");
    const now = nowIso();
    await insertBusinessBrainEntry(transaction, {
      id: entryId,
      tenantId,
      entryKey: id("brain_memory"),
      ...parsed,
      actorId: userId,
      version: 1,
      now,
    });
    await insertBusinessBrainEvidence(transaction, {
      id: id("brain_evidence"),
      tenantId,
      entryId,
      evidenceType: parsed.evidenceType,
      sourceRef: parsed.sourceRef,
      summary: parsed.evidenceSummary,
      actorId: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "business_brain.entry_created",
      targetType: "business_brain_entry",
      targetId: entryId,
      metadata: {
        domain: parsed.domain,
        confidence: parsed.confidence,
        version: 1,
      },
    });
    return entryId;
  });
}

export async function reviseBusinessBrainEntry(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: ReviseBusinessBrainEntryInput,
) {
  const parsed = reviseBusinessBrainEntrySchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...writableRoles]);
    const current = await findActiveBusinessBrainEntry(
      transaction,
      tenantId,
      parsed.entryId,
    );
    if (!current) {
      throw new BusinessBrainError(
        "business_brain_entry_not_found",
        "Cette information n'existe pas ou n'est plus active.",
      );
    }

    const now = nowIso();
    const superseded = await supersedeBusinessBrainEntry(
      transaction,
      tenantId,
      current.id,
      now,
    );
    if (!superseded) {
      throw new BusinessBrainError(
        "business_brain_revision_conflict",
        "Cette information a déjà été modifiée.",
      );
    }

    const entryId = id("brain_entry");
    await insertBusinessBrainEntry(transaction, {
      id: entryId,
      tenantId,
      entryKey: current.entry_key,
      ...parsed,
      actorId: userId,
      version: current.version + 1,
      supersedesId: current.id,
      now,
    });
    await insertBusinessBrainEvidence(transaction, {
      id: id("brain_evidence"),
      tenantId,
      entryId,
      evidenceType: parsed.evidenceType,
      sourceRef: parsed.sourceRef,
      summary: parsed.evidenceSummary,
      actorId: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "business_brain.entry_revised",
      targetType: "business_brain_entry",
      targetId: entryId,
      metadata: {
        domain: parsed.domain,
        previousEntryId: current.id,
        version: current.version + 1,
      },
    });
    return entryId;
  });
}

export async function archiveBusinessBrainEntry(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { entryId: string },
) {
  const parsed = archiveBusinessBrainEntrySchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...writableRoles]);
    const archived = await archiveBusinessBrainEntryRecord(
      transaction,
      tenantId,
      parsed.entryId,
      nowIso(),
    );
    if (!archived) {
      throw new BusinessBrainError(
        "business_brain_entry_not_found",
        "Cette information n'existe pas ou n'est plus active.",
      );
    }
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "business_brain.entry_archived",
      targetType: "business_brain_entry",
      targetId: parsed.entryId,
      metadata: {},
    });
  });
}

function mapEntry(row: BusinessBrainEntryRow) {
  return {
    id: row.id,
    entryKey: row.entry_key,
    domain: row.domain,
    title: row.title,
    summary: row.summary,
    details: row.details,
    sourceType: row.source_type,
    sourceRef: row.source_ref ?? undefined,
    confidence: row.confidence,
    version: row.version,
    supersedesId: row.supersedes_id ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildCoverage(
  profile: BusinessProfile | null,
  entries: Array<{ domain: BusinessBrainDomain }>,
  signals: {
    contacts: number;
    opportunities: number;
    members: number;
    activeWorkflows: number;
    websites: number;
    connectors: number;
    apiAssets: number;
  },
) {
  const managedCounts = new Map<BusinessBrainDomain, number>();
  for (const entry of entries) {
    managedCounts.set(entry.domain, (managedCounts.get(entry.domain) ?? 0) + 1);
  }

  const systemSources: Partial<Record<BusinessBrainDomain, number>> = {
    company: profile?.identity.companyName ? 1 : 0,
    customers: signals.contacts,
    catalog: (profile?.services.length ?? 0) + (profile?.products.length ?? 0),
    objectives: profile?.salesObjectives ? 1 : 0,
    team: signals.members,
    locations:
      (profile?.geographicalAreas.length ?? 0) +
      (profile?.contactMethods.address ? 1 : 0),
    automations: signals.activeWorkflows,
    websites: signals.websites,
    api: signals.apiAssets,
    connectors: signals.connectors,
  };

  return businessBrainDomainSchema.options.map((domain) => {
    const managed = managedCounts.get(domain) ?? 0;
    const connected = systemSources[domain] ?? 0;
    return {
      domain,
      managedEntries: managed,
      connectedRecords: connected,
      status:
        managed > 0 || connected > 0
          ? managed > 0 && connected > 0
            ? ("complete" as const)
            : ("partial" as const)
          : ("missing" as const),
    };
  });
}
