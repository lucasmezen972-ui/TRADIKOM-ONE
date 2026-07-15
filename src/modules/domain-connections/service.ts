import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import {
  correlationId,
  daysFromNow,
  id,
  nowIso,
  safeJson,
} from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { DomainConnectionError } from "@/modules/domain-connections/errors";
import {
  assertDnsChangesAreSafe,
  buildManualSetupGuide,
  getDomainProviderAdapter,
  normalizeDomain,
} from "@/modules/domain-connections/providers";
import {
  completeDomainVerificationJob,
  failDomainVerificationJob,
  failWebsiteDomainBinding,
  findDnsChangePlan,
  findDomainVerificationJob,
  findDomainConnection,
  findLatestDnsSnapshot,
  findLatestSimulatedDnsChangePlan,
  findWebsiteDomainBinding,
  findWebsiteDomainBindingByConnection,
  insertDomainVerificationJob,
  insertDnsChangePlan,
  insertDnsPlanApproval,
  insertDnsSnapshot,
  listDnsChangePlans,
  listDomainConnections,
  listWebsiteDomainBindings,
  markDomainConnectionVerified,
  markDomainVerificationProcessing,
  markWebsiteDomainBindingBound,
  markWebsiteDomainBindingDisconnected,
  updateDnsChangePlanStatus,
  updateDomainConnectionState,
  upsertWebsiteDomainBinding,
  upsertDomainConnection,
} from "@/modules/domain-connections/repository";
import {
  analyzeDomainConnectionSchema,
  dnsPlanReferenceSchema,
  prepareDnsChangePlanSchema,
  websiteDomainBindingReferenceSchema,
  websiteDomainBindingRequestSchema,
  type AnalyzeDomainConnectionInput,
  type DnsChange,
  type DnsRecord,
  type DomainEvidence,
  type PrepareDnsChangePlanInput,
} from "@/modules/domain-connections/schemas";
import { assertTenantAccess } from "@/modules/tenants";
import { findWebsite } from "@/modules/websites/repository";
import { enqueueDomainEvent } from "@/modules/workflows/engine";

const domainAdminRoles = ["owner", "administrator"] as const;
export const domainVerificationRequestedEventType =
  "domain.verification_requested";

export async function getDomainConnectionWorkspace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  const role = await assertTenantAccess(db, userId, tenantId);
  const [connections, plans, bindings] = await Promise.all([
    listDomainConnections(db, tenantId),
    listDnsChangePlans(db, tenantId),
    listWebsiteDomainBindings(db, tenantId),
  ]);
  const connectionViews = await Promise.all(
    connections.map(async (connection) => {
      const snapshot = await findLatestDnsSnapshot(db, tenantId, connection.id);
      return mapConnection(
        connection,
        safeJson<DnsRecord[]>(snapshot?.records, []),
      );
    }),
  );
  return {
    canManage: domainAdminRoles.includes(role as (typeof domainAdminRoles)[number]),
    connections: connectionViews,
    plans: plans.map(mapPlan),
    bindings: bindings.map(mapBinding),
  };
}

export async function analyzeDomainConnection(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: AnalyzeDomainConnectionInput,
) {
  const parsed = analyzeDomainConnectionSchema.parse(input);
  const normalizedDomain = normalizeDomain(parsed.domain);
  const adapter = getDomainProviderAdapter(parsed.providerKey);
  const now = nowIso();
  const analysis = await adapter.analyze(normalizedDomain, now);
  const state =
    adapter.key === "manual" ? "manual_setup_required" : "analyzed";

  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...domainAdminRoles]);
    const connection = await upsertDomainConnection(transaction, {
      id: id("domain"),
      tenantId,
      normalizedDomain,
      providerKey: adapter.key,
      providerLabel: analysis.providerLabel,
      state,
      likelyRegistrar: analysis.likelyRegistrar,
      likelyHosting: analysis.likelyHosting,
      certificateStatus: analysis.certificateStatus,
      evidence: analysis.evidence,
      createdBy: userId,
      now,
    });
    if (!connection) {
      throw new DomainConnectionError(
        "domain_connection_not_found",
        "La connexion de domaine n'a pas pu être créée.",
      );
    }
    const snapshotId = id("dns_snapshot");
    await insertDnsSnapshot(transaction, {
      id: snapshotId,
      tenantId,
      connectionId: connection.id,
      records: analysis.records,
      evidence: analysis.evidence,
      capturedAt: now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "domain_connection.analyzed",
      targetType: "domain_connection",
      targetId: connection.id,
      metadata: {
        providerKey: adapter.key,
        evidenceCount: analysis.evidence.length,
        recordCount: analysis.records.length,
        networkUsed: false,
      },
    });
    return {
      connectionId: connection.id,
      snapshotId,
      domain: normalizedDomain,
      state,
      provider: analysis.providerLabel,
      records: analysis.records,
      evidence: analysis.evidence,
      capabilities: adapter.capabilities,
    };
  });
}

export async function prepareDnsChangePlan(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: PrepareDnsChangePlanInput,
) {
  const parsed = prepareDnsChangePlanSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...domainAdminRoles]);
    const connection = await findDomainConnection(
      transaction,
      tenantId,
      parsed.connectionId,
    );
    if (!connection) throw connectionNotFound();
    const snapshot = await findLatestDnsSnapshot(
      transaction,
      tenantId,
      connection.id,
    );
    if (!snapshot) {
      throw new DomainConnectionError(
        "domain_snapshot_not_found",
        "Aucun instantané DNS n'est disponible.",
      );
    }
    const records = safeJson<DnsRecord[]>(snapshot.records, []);
    const changes = parsed.changes ?? defaultWebsiteChange();
    assertDnsChangesAreSafe(records, changes);
    const now = nowIso();
    const planId = id("dns_plan");
    await insertDnsChangePlan(transaction, {
      id: planId,
      tenantId,
      connectionId: connection.id,
      snapshotId: snapshot.id,
      providerKey: connection.provider_key,
      proposedChanges: changes,
      impactAnalysis: {
        mailRisk: "Aucun enregistrement MX, SPF, DKIM ou DMARC n'est modifié.",
        websiteRisk: "Le plan ajoute une cible web sans remplacer le site actuel.",
        destructiveChange: false,
        externalChangeApplied: false,
      },
      rollbackSnapshot: records,
      verificationChecks: changes.map(
        (change) => `${change.record.type} ${change.record.name} correspond à la valeur planifiée`,
      ),
      expiresAt: daysFromNow(1),
      createdBy: userId,
      now,
    });
    await updateDomainConnectionState(transaction, {
      tenantId,
      connectionId: connection.id,
      state: "awaiting_approval",
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "domain_connection.dns_plan_prepared",
      targetType: "dns_change_plan",
      targetId: planId,
      metadata: {
        changeCount: changes.length,
        destructiveChange: false,
        externalChangeApplied: false,
      },
    });
    return {
      planId,
      status: "awaiting_approval" as const,
      changes,
      manualGuide: buildManualSetupGuide(changes),
    };
  });
}

export async function approveDnsChangePlan(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { planId: string },
) {
  const parsed = dnsPlanReferenceSchema.parse(input);
  return decideDnsPlanStep(db, userId, tenantId, parsed.planId, {
    expectedStatus: "awaiting_approval",
    approvalType: "primary",
    nextStatus: "awaiting_second_confirmation",
    action: "domain_connection.dns_plan_approved",
  });
}

export async function confirmDnsChangePlan(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { planId: string },
) {
  const parsed = dnsPlanReferenceSchema.parse(input);
  return decideDnsPlanStep(db, userId, tenantId, parsed.planId, {
    expectedStatus: "awaiting_second_confirmation",
    approvalType: "second_confirmation",
    nextStatus: "approved_for_simulation",
    action: "domain_connection.dns_plan_confirmed",
    revalidateSnapshot: true,
  });
}

export async function simulateDnsChangePlan(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { planId: string },
) {
  const parsed = dnsPlanReferenceSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...domainAdminRoles]);
    const plan = await requirePlan(transaction, tenantId, parsed.planId);
    if (plan.status !== "approved_for_simulation") throw invalidPlanState();
    assertPlanNotExpired(plan.expires_at);
    const adapter = getDomainProviderAdapter(plan.provider_key);
    const changes = safeJson<DnsChange[]>(plan.proposed_changes, []);
    const now = nowIso();
    await updateDnsChangePlanStatus(transaction, {
      tenantId,
      planId: plan.id,
      status: "simulated",
      now,
    });
    await updateDomainConnectionState(transaction, {
      tenantId,
      connectionId: plan.domain_connection_id,
      state: "change_plan_ready",
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "domain_connection.dns_plan_simulated",
      targetType: "dns_change_plan",
      targetId: plan.id,
      metadata: {
        providerKey: adapter.key,
        providerSandbox: adapter.capabilities.sandbox,
        verificationOnly: !adapter.capabilities.sandbox,
        changeCount: changes.length,
        externalChangeApplied: false,
      },
    });
    return {
      planId: plan.id,
      status: "simulated" as const,
      environment: adapter.capabilities.sandbox ? "mock" : "manual",
      externalChangeApplied: false,
      checks: safeJson<string[]>(plan.verification_checks, []),
      manualGuide: buildManualSetupGuide(changes),
    };
  });
}

export async function requestWebsiteDomainBinding(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { connectionId: string },
) {
  const parsed = websiteDomainBindingRequestSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...domainAdminRoles]);
    const connection = await findDomainConnection(
      transaction,
      tenantId,
      parsed.connectionId,
    );
    if (!connection) throw connectionNotFound();
    const adapter = getDomainProviderAdapter(connection.provider_key);
    if (!adapter.capabilities.validatePropagation) {
      throw new DomainConnectionError(
        "domain_verification_unavailable",
        "Ce fournisseur ne permet pas encore la validation de propagation.",
      );
    }
    const plan = await findLatestSimulatedDnsChangePlan(
      transaction,
      tenantId,
      connection.id,
    );
    if (!plan) {
      throw new DomainConnectionError(
        "dns_plan_not_simulated",
        "Le plan DNS doit être approuvé et simulé avant la liaison.",
      );
    }
    assertPlanNotExpired(plan.expires_at);
    const website = await findWebsite(transaction, tenantId);
    if (!website?.current_published_version_id) {
      throw new DomainConnectionError(
        "website_not_published",
        "Publiez d'abord une version du site avant de lier ce domaine.",
      );
    }
    const existing = await findWebsiteDomainBindingByConnection(
      transaction,
      tenantId,
      connection.id,
    );
    if (existing && ["pending_verification", "bound"].includes(existing.status)) {
      return {
        bindingId: existing.id,
        jobId: null,
        status: existing.status,
        idempotentReplay: true,
      };
    }
    const now = nowIso();
    const binding = await upsertWebsiteDomainBinding(transaction, {
      id: id("domain_binding"),
      tenantId,
      websiteId: website.id,
      connectionId: connection.id,
      planId: plan.id,
      publishedVersionId: website.current_published_version_id,
      actorId: userId,
      now,
    });
    if (!binding) {
      throw new DomainConnectionError(
        "domain_binding_not_created",
        "La demande de liaison n'a pas pu être enregistrée.",
      );
    }
    const jobId = id("domain_verification");
    const requestCorrelationId = correlationId();
    await insertDomainVerificationJob(transaction, {
      id: jobId,
      tenantId,
      bindingId: binding.id,
      correlationId: requestCorrelationId,
      actorId: userId,
      now,
    });
    await enqueueDomainEvent(transaction, {
      id: id("event"),
      tenantId,
      actorId: userId,
      type: domainVerificationRequestedEventType,
      payload: { jobId },
      idempotencyKey: `domain-verification:${jobId}`,
      correlationId: requestCorrelationId,
    });
    await updateDomainConnectionState(transaction, {
      tenantId,
      connectionId: connection.id,
      state: "propagation_pending",
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "domain_connection.binding_requested",
      targetType: "website_domain_binding",
      targetId: binding.id,
      metadata: {
        providerKey: connection.provider_key,
        publishedSnapshotLocked: true,
        draftPublished: false,
        externalChangeApplied: false,
      },
    });
    return {
      bindingId: binding.id,
      jobId,
      status: "pending_verification" as const,
      idempotentReplay: false,
    };
  });
}

export async function processDomainVerificationJob(
  db: DbClient,
  actorId: string,
  tenantId: string,
  jobId: string,
) {
  return withTenantDbTransaction(db, tenantId, actorId, async (transaction) => {
    const job = await findDomainVerificationJob(transaction, tenantId, jobId);
    if (!job) {
      throw new DomainConnectionError(
        "domain_verification_not_found",
        "La vérification de domaine est introuvable.",
      );
    }
    if (job.status === "verified") {
      return { jobId, status: "verified" as const, idempotentReplay: true };
    }
    if (["failed", "cancelled"].includes(job.status)) {
      return {
        jobId,
        status: job.status as "failed" | "cancelled",
        idempotentReplay: true,
      };
    }
    if (job.status !== "queued") {
      throw new DomainConnectionError(
        "domain_verification_in_progress",
        "La vérification est déjà en cours.",
      );
    }
    const binding = await findWebsiteDomainBinding(
      transaction,
      tenantId,
      job.website_domain_binding_id,
    );
    if (!binding || binding.status !== "pending_verification") {
      throw new DomainConnectionError(
        "domain_binding_invalid_state",
        "La liaison de domaine n'est pas dans l'état attendu.",
      );
    }
    const connection = await findDomainConnection(
      transaction,
      tenantId,
      binding.domain_connection_id,
    );
    const plan = await findDnsChangePlan(
      transaction,
      tenantId,
      binding.dns_change_plan_id,
    );
    if (!connection || !plan || plan.status !== "simulated") {
      throw new DomainConnectionError(
        "domain_binding_evidence_missing",
        "Les preuves de liaison ne sont plus disponibles.",
      );
    }
    const now = nowIso();
    await markDomainVerificationProcessing(transaction, {
      tenantId,
      jobId,
      now,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const adapter = getDomainProviderAdapter(connection.provider_key);
    const validation = await adapter.validatePropagation({
      domain: connection.normalized_domain,
      changes: safeJson<DnsChange[]>(plan.proposed_changes, []),
      observedAt: now,
    });
    if (!validation.verified) {
      const errorCode = validation.safeErrorCode ?? "domain_propagation_unverified";
      await failDomainVerificationJob(transaction, {
        tenantId,
        jobId,
        errorCode,
        now,
      });
      await failWebsiteDomainBinding(transaction, {
        tenantId,
        bindingId: binding.id,
        errorCode,
        now,
      });
      await updateDomainConnectionState(transaction, {
        tenantId,
        connectionId: connection.id,
        state: "failed",
        now,
      });
      await recordAuditLog(transaction, {
        tenantId,
        actorId,
        action: "domain_connection.binding_verification_failed",
        targetType: "website_domain_binding",
        targetId: binding.id,
        metadata: { errorCode, externalChangeApplied: false },
      });
      return { jobId, status: "failed" as const, errorCode };
    }
    const latestSnapshot = await findLatestDnsSnapshot(
      transaction,
      tenantId,
      connection.id,
    );
    await insertDnsSnapshot(transaction, {
      id: id("dns_snapshot"),
      tenantId,
      connectionId: connection.id,
      records: applyDnsChanges(
        safeJson<DnsRecord[]>(latestSnapshot?.records, []),
        safeJson<DnsChange[]>(plan.proposed_changes, []),
      ),
      evidence: validation.evidence,
      capturedAt: now,
    });
    await completeDomainVerificationJob(transaction, { tenantId, jobId, now });
    await markWebsiteDomainBindingBound(transaction, {
      tenantId,
      bindingId: binding.id,
      now,
    });
    await markDomainConnectionVerified(transaction, {
      tenantId,
      connectionId: connection.id,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId,
      action: "domain_connection.binding_verified",
      targetType: "website_domain_binding",
      targetId: binding.id,
      metadata: {
        providerKey: connection.provider_key,
        certificateStatus: validation.certificateStatus,
        publishedSnapshotLocked: true,
        draftPublished: false,
        externalChangeApplied: false,
      },
    });
    return { jobId, status: "verified" as const, idempotentReplay: false };
  });
}

export async function disconnectWebsiteDomainBinding(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { bindingId: string },
) {
  const parsed = websiteDomainBindingReferenceSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...domainAdminRoles]);
    const binding = await findWebsiteDomainBinding(
      transaction,
      tenantId,
      parsed.bindingId,
    );
    if (!binding) {
      throw new DomainConnectionError(
        "domain_binding_not_found",
        "La liaison de domaine est introuvable.",
      );
    }
    if (!["bound", "failed"].includes(binding.status)) {
      throw new DomainConnectionError(
        "domain_binding_invalid_state",
        "Cette liaison ne peut pas être déconnectée.",
      );
    }
    const now = nowIso();
    await markWebsiteDomainBindingDisconnected(transaction, {
      tenantId,
      bindingId: binding.id,
      now,
    });
    await updateDomainConnectionState(transaction, {
      tenantId,
      connectionId: binding.domain_connection_id,
      state: "disconnected",
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "domain_connection.binding_disconnected",
      targetType: "website_domain_binding",
      targetId: binding.id,
      metadata: {
        dnsRecordsRemoved: false,
        publishedSnapshotChanged: false,
        rollbackInstructionsRequired: true,
      },
    });
    return { bindingId: binding.id, status: "disconnected" as const };
  });
}

async function decideDnsPlanStep(
  db: DbClient,
  userId: string,
  tenantId: string,
  planId: string,
  step: {
    expectedStatus: string;
    approvalType: "primary" | "second_confirmation";
    nextStatus: string;
    action: string;
    revalidateSnapshot?: boolean;
  },
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...domainAdminRoles]);
    const plan = await requirePlan(transaction, tenantId, planId);
    if (plan.status !== step.expectedStatus) throw invalidPlanState();
    assertPlanNotExpired(plan.expires_at);
    if (step.revalidateSnapshot) {
      const latest = await findLatestDnsSnapshot(
        transaction,
        tenantId,
        plan.domain_connection_id,
      );
      if (!latest || latest.id !== plan.dns_snapshot_id) {
        throw new DomainConnectionError(
          "dns_state_changed",
          "L'état DNS a changé. Préparez un nouveau plan.",
        );
      }
    }
    const now = nowIso();
    await insertDnsPlanApproval(transaction, {
      id: id("dns_approval"),
      tenantId,
      planId: plan.id,
      approvalType: step.approvalType,
      actorId: userId,
      now,
    });
    await updateDnsChangePlanStatus(transaction, {
      tenantId,
      planId: plan.id,
      status: step.nextStatus,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: step.action,
      targetType: "dns_change_plan",
      targetId: plan.id,
      metadata: {
        approvalType: step.approvalType,
        externalChangeApplied: false,
      },
    });
    return { planId: plan.id, status: step.nextStatus };
  });
}

async function requirePlan(db: DbClient, tenantId: string, planId: string) {
  const plan = await findDnsChangePlan(db, tenantId, planId);
  if (!plan) {
    throw new DomainConnectionError(
      "dns_plan_not_found",
      "Le plan DNS est introuvable.",
    );
  }
  return plan;
}

function connectionNotFound() {
  return new DomainConnectionError(
    "domain_connection_not_found",
    "La connexion de domaine est introuvable.",
  );
}

function invalidPlanState() {
  return new DomainConnectionError(
    "dns_plan_invalid_state",
    "Le plan DNS n'est pas dans l'état attendu.",
  );
}

function assertPlanNotExpired(expiresAt: string) {
  if (new Date(expiresAt).getTime() <= Date.now()) {
    throw new DomainConnectionError(
      "dns_plan_expired",
      "Le plan DNS a expiré.",
    );
  }
}

function defaultWebsiteChange(): DnsChange[] {
  return [
    {
      action: "create",
      record: {
        type: "CNAME",
        name: "www",
        value: "sites.mock.tradikom.invalid",
        ttl: 300,
        priority: null,
      },
      previousRecord: null,
      reason: "Préparer la liaison du site sans remplacer le domaine racine.",
    },
  ];
}

function mapConnection(
  row: Awaited<ReturnType<typeof listDomainConnections>>[number],
  records: DnsRecord[],
) {
  const adapter = getDomainProviderAdapter(row.provider_key);
  return {
    id: row.id,
    domain: row.normalized_domain,
    providerKey: row.provider_key,
    providerLabel: row.provider_label,
    state: row.state,
    likelyRegistrar: row.likely_registrar,
    likelyHosting: row.likely_hosting,
    certificateStatus: row.certificate_status,
    evidence: safeJson<DomainEvidence[]>(row.evidence, []),
    records,
    capabilities: adapter.capabilities,
    updatedAt: row.updated_at,
  };
}

function mapPlan(row: Awaited<ReturnType<typeof listDnsChangePlans>>[number]) {
  return {
    id: row.id,
    connectionId: row.domain_connection_id,
    status: row.status,
    changes: safeJson<DnsChange[]>(row.proposed_changes, []),
    impact: safeJson<Record<string, unknown>>(row.impact_analysis, {}),
    checks: safeJson<string[]>(row.verification_checks, []),
    manualGuide: buildManualSetupGuide(
      safeJson<DnsChange[]>(row.proposed_changes, []),
    ),
    expiresAt: row.expires_at,
  };
}

function mapBinding(
  row: Awaited<ReturnType<typeof listWebsiteDomainBindings>>[number],
) {
  return {
    id: row.id,
    connectionId: row.domain_connection_id,
    websiteId: row.website_id,
    status: row.status,
    certificateStatus: row.certificate_status,
    safeErrorCode: row.safe_error_code,
    publishedSnapshotLocked: Boolean(row.published_version_id_at_request),
    verifiedAt: row.verified_at,
    disconnectedAt: row.disconnected_at,
    updatedAt: row.updated_at,
  };
}

function applyDnsChanges(records: DnsRecord[], changes: DnsChange[]) {
  const next = [...records];
  for (const change of changes) {
    const index = next.findIndex(
      (record) =>
        record.type === change.record.type && record.name === change.record.name,
    );
    if (change.action === "delete") {
      if (index >= 0) next.splice(index, 1);
    } else if (index >= 0) {
      next[index] = change.record;
    } else {
      next.push(change.record);
    }
  }
  return next;
}
