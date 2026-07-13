import type { DbClient } from "@/lib/db";
import { id, nowIso, safeJson } from "@/lib/security";
import { withTenantDbTransaction } from "@/db/tenant-context";
import { recordAuditLog } from "@/modules/audit";
import {
  type ApiContractPreview,
  previewOpenApiDocument,
  previewPostmanCollection,
} from "@/modules/api-intelligence/analyzer";
import {
  compareApiSnapshots,
  type ApiSnapshotDescriptor,
} from "@/modules/api-intelligence/change-monitor/compare";
import { ApiChangeMonitorError } from "@/modules/api-intelligence/change-monitor/errors";
import {
  blockConnectorForApiChange,
  decideApiChangeImpact,
  findApiChangeEventBySnapshots,
  findApiChangeImpact,
  insertApiChangeContractRun,
  insertApiChangeEvent,
  insertApiChangeImpact,
  listConnectorProposalsForApiProduct,
  mapApiChangeEvent,
} from "@/modules/api-intelligence/change-monitor/repository";
import { apiChangeDecisionSchema } from "@/modules/api-intelligence/change-monitor/schemas";
import { connectorManifestSchema } from "@/modules/connector-copilot/schemas";
import { upsertDetectedOpportunityAlert } from "@/modules/opportunity-radar/repository";
import { assertPlatformAdmin } from "@/modules/platform-admin";
import type {
  ApiSnapshotRow,
  ApiSourceRow,
} from "@/modules/software-directory";

const globalReviewKinds = new Set([
  "access_policy_changed",
  "specification_unreadable",
  "schema_removed",
  "authentication_changed",
  "scopes_changed",
  "webhook_support_changed",
]);
const operationReviewKinds = new Set([
  "endpoint_removed",
  "endpoint_signature_changed",
  "operation_security_changed",
]);

export async function detectApiSnapshotChange(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: {
    source: ApiSourceRow;
    previousSnapshot: ApiSnapshotRow;
    currentSnapshot: ApiSnapshotRow;
  },
) {
  await assertPlatformAdmin(db, userId, tenantId);
  if (!input.source.api_product_id) return null;

  const existing = await findApiChangeEventBySnapshots(
    db,
    input.previousSnapshot.id,
    input.currentSnapshot.id,
  );
  if (existing) return mapApiChangeEvent(existing);

  const previous = describeSnapshot(
    input.previousSnapshot,
    input.source.api_product_id,
    input.source.source_type,
  );
  const current = describeSnapshot(
    input.currentSnapshot,
    input.source.api_product_id,
    input.source.source_type,
  );
  const comparison = compareApiSnapshots({ previous, current });
  if (comparison.summary.changes.length === 0) return null;
  const changeEventId = id("api_change");
  const detectedAt = nowIso();
  await insertApiChangeEvent(db, {
    id: changeEventId,
    apiProductId: input.source.api_product_id,
    sourceId: input.source.id,
    previousSnapshotId: input.previousSnapshot.id,
    currentSnapshotId: input.currentSnapshot.id,
    primaryClassification: comparison.primaryClassification,
    classifications: comparison.classifications,
    summary: comparison.summary,
    requiresApproval: comparison.requiresApproval,
    detectedAt,
  });

  let affectedConnectorCount = 0;
  const affectedTenants = new Set<string>();
  if (comparison.requiresApproval) {
    const proposals = await listConnectorProposalsForApiProduct(
      db,
      input.source.api_product_id,
    );
    for (const proposal of proposals) {
      const impact = evaluateConnectorImpact(
        safeJson<unknown>(proposal.manifest, null),
        comparison.summary.changes,
        current.preview,
      );
      if (!impact.affected) continue;

      const contractRunId = id("contract");
      const impactId = id("api_impact");
      const testResults = {
        monitorVersion: "api-change-1",
        missingOperations: impact.missingOperations,
        changedOperations: impact.changedOperations,
        globalReasons: impact.globalReasons,
        safeToUpgrade: false,
      };
      await insertApiChangeContractRun(db, {
        id: contractRunId,
        tenantId: proposal.tenant_id,
        proposalId: proposal.id,
        connectorVersion: proposal.version,
        apiVersion: current.preview?.version ?? "unreadable",
        status: "failed",
        results: testResults,
        safeLogs: [
          "Le contrat de changement exige une revue humaine.",
          `${impact.missingOperations.length} operation(s) absente(s).`,
          `${impact.changedOperations.length} operation(s) modifiee(s).`,
        ],
        createdAt: detectedAt,
      });
      await insertApiChangeImpact(db, {
        id: impactId,
        tenantId: proposal.tenant_id,
        changeEventId,
        proposalId: proposal.id,
        contractRunId,
        repairProposal: {
          proposalVersion: "api-repair-1",
          enabled: false,
          connectorProposalId: proposal.id,
          changeEventId,
          missingOperations: impact.missingOperations,
          changedOperations: impact.changedOperations,
          suggestedActions: repairActions(impact),
          requiresApproval: true,
        },
        contractTestStatus: "failed",
        contractTestResults: testResults,
        createdAt: detectedAt,
      });
      await blockConnectorForApiChange(db, {
        tenantId: proposal.tenant_id,
        proposalId: proposal.id,
        updatedAt: detectedAt,
      });
      await upsertDetectedOpportunityAlert(db, {
        id: id("radar"),
        tenantId: proposal.tenant_id,
        ruleKey: "api_breaking_change",
        severity: "critical",
        title: "Changement API a examiner",
        explanation: `${proposal.name} est bloque jusqu'a validation de la proposition de reparation.`,
        entityType: "api_change_impact",
        entityId: impactId,
        actionLabel: "Examiner le changement",
        actionHref: "/intelligence-api#changements-api",
        detectedAt,
        updatedAt: detectedAt,
      });
      await recordAuditLog(db, {
        tenantId: proposal.tenant_id,
        actorId: userId,
        action: "api_intelligence.connector_upgrade_blocked",
        targetType: "api_change_impact",
        targetId: impactId,
        metadata: {
          changeEventId,
          connectorProposalId: proposal.id,
          contractRunId,
          connectorEnabled: false,
        },
      });
      affectedConnectorCount += 1;
      affectedTenants.add(proposal.tenant_id);
    }
  }

  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "api_intelligence.change_detected",
    targetType: "api_change_event",
    targetId: changeEventId,
    metadata: {
      primaryClassification: comparison.primaryClassification,
      affectedConnectorCount,
      affectedTenantCount: affectedTenants.size,
      requiresApproval: comparison.requiresApproval,
    },
  });

  return {
    id: changeEventId,
    ...comparison,
    affectedConnectorCount,
    affectedTenantCount: affectedTenants.size,
    detectedAt,
  };
}

export async function decideApiChangeRepair(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: unknown,
) {
  const parsed = apiChangeDecisionSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const impact = await findApiChangeImpact(
      transaction,
      tenantId,
      parsed.impactId,
    );
    if (!impact) {
      throw new ApiChangeMonitorError(
        "impact_not_found",
        "Impact de changement API introuvable.",
      );
    }
    if (impact.approval_status !== "pending") {
      throw new ApiChangeMonitorError(
        "decision_invalid",
        "Cette proposition de reparation a deja ete examinee.",
      );
    }
    const decidedAt = nowIso();
    await decideApiChangeImpact(transaction, {
      tenantId,
      impactId: parsed.impactId,
      decision: parsed.decision,
      reason: parsed.reason,
      decidedBy: userId,
      decidedAt,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: `api_intelligence.repair_${parsed.decision}`,
      targetType: "api_change_impact",
      targetId: parsed.impactId,
      metadata: {
        connectorProposalId: impact.connector_proposal_id,
        upgradeBlocked: true,
        automaticActivation: false,
      },
    });
    return {
      impactId: parsed.impactId,
      decision: parsed.decision,
      upgradeBlocked: true as const,
      connectorEnabled: false as const,
    };
  });
}

function describeSnapshot(
  snapshot: ApiSnapshotRow,
  apiProductId: string,
  sourceType: string,
): ApiSnapshotDescriptor {
  const descriptor = {
    contentHash: snapshot.content_hash,
    etag: snapshot.etag ?? undefined,
    lastModified: snapshot.last_modified ?? undefined,
    accessPolicyDecision: snapshot.access_policy_decision,
    robotsDecision: snapshot.robots_decision,
  };
  if (
    sourceType !== "official_openapi_specification" &&
    sourceType !== "official_postman_collection"
  ) {
    return descriptor;
  }
  try {
    return {
      ...descriptor,
      preview:
        sourceType === "official_postman_collection"
          ? previewPostmanCollection({
              snapshotId: snapshot.id,
              apiProductId,
              sourceHash: snapshot.content_hash,
              content: snapshot.content,
            })
          : previewOpenApiDocument({
              snapshotId: snapshot.id,
              apiProductId,
              sourceHash: snapshot.content_hash,
              content: snapshot.content,
              contentType: snapshot.content_type,
            }),
    };
  } catch {
    return {
      ...descriptor,
      parseFailed: true,
    };
  }
}

function evaluateConnectorImpact(
  manifestValue: unknown,
  changes: Array<{ kind: string; target?: string }>,
  currentPreview?: ApiContractPreview,
) {
  const parsed = connectorManifestSchema.safeParse(manifestValue);
  if (!parsed.success) {
    return {
      affected: true,
      missingOperations: [] as string[],
      changedOperations: [] as string[],
      globalReasons: ["connector_manifest_invalid"],
    };
  }
  const currentOperations = new Set(
    currentPreview?.operations.map((operation) => operation.operationKey) ?? [],
  );
  const manifestOperations = parsed.data.capabilities.map(
    (capability) => capability.operationKey,
  );
  const missingOperations = manifestOperations.filter(
    (operationKey) => !currentOperations.has(operationKey),
  );
  const changedTargets = new Set(
    changes
      .filter((item) => operationReviewKinds.has(item.kind) && item.target)
      .map((item) => item.target as string),
  );
  const changedOperations = manifestOperations.filter((operationKey) =>
    changedTargets.has(operationKey),
  );
  const globalReasons = changes
    .filter((item) => globalReviewKinds.has(item.kind))
    .map((item) => item.kind);
  return {
    affected:
      missingOperations.length > 0 ||
      changedOperations.length > 0 ||
      globalReasons.length > 0,
    missingOperations,
    changedOperations,
    globalReasons,
  };
}

function repairActions(input: {
  missingOperations: string[];
  changedOperations: string[];
  globalReasons: string[];
}) {
  const actions = ["Regenerer le manifeste depuis les preuves approuvees."];
  if (input.missingOperations.length > 0) {
    actions.push("Remapper ou retirer les operations disparues.");
  }
  if (input.changedOperations.length > 0) {
    actions.push("Mettre a jour les contrats des operations modifiees.");
  }
  if (input.globalReasons.length > 0) {
    actions.push("Revalider l'authentification, les scopes et la politique d'acces.");
  }
  actions.push("Relancer les tests sandbox avant toute approbation.");
  return actions;
}
