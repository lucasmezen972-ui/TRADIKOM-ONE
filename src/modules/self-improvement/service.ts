import { createHash } from "node:crypto";
import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { SelfImprovementError } from "@/modules/self-improvement/errors";
import {
  closeCurrentSelfImprovementProposal,
  countDuplicateContactPairs,
  findCurrentSelfImprovementProposal,
  getNextSelfImprovementVersion,
  insertSelfImprovementDecision,
  insertSelfImprovementEvidence,
  insertSelfImprovementProposal,
  listConnectorImprovementSignals,
  listCurrentSelfImprovementProposals,
  listSelfImprovementEvidence,
  listWebsiteHeroImprovementSignals,
  listWebsitePageImprovementSignals,
  listWorkflowImprovementSignals,
  updateSelfImprovementDecisionStatus,
} from "@/modules/self-improvement/repository";
import {
  buildSelfImprovementCandidates,
  selfImprovementCoverage,
} from "@/modules/self-improvement/rules";
import {
  selfImprovementDecisionSchema,
  type SelfImprovementDecisionInput,
} from "@/modules/self-improvement/schemas";
import { assertTenantAccess } from "@/modules/tenants";

const managerRoles = ["owner", "administrator", "manager"] as const;

export async function getSelfImprovementWorkspace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  const role = await assertTenantAccess(db, userId, tenantId);
  const [proposals, evidence] = await Promise.all([
    listCurrentSelfImprovementProposals(db, tenantId),
    listSelfImprovementEvidence(db, tenantId),
  ]);
  const evidenceByProposal = new Map<string, typeof evidence>();
  for (const item of evidence) {
    const list = evidenceByProposal.get(item.proposal_id) ?? [];
    list.push(item);
    evidenceByProposal.set(item.proposal_id, list);
  }
  return {
    canManage: managerRoles.some((allowed) => allowed === role),
    coverage: selfImprovementCoverage,
    proposals: proposals.map((proposal) => ({
      id: proposal.id,
      proposalKey: proposal.proposal_key,
      category: proposal.category,
      title: proposal.title,
      explanation: proposal.explanation,
      recommendation: proposal.recommendation,
      actionLabel: proposal.action_label,
      actionHref: proposal.action_href,
      severity: proposal.severity,
      confidence: Number(proposal.confidence),
      decisionStatus: proposal.decision_status,
      version: Number(proposal.version),
      createdAt: proposal.created_at,
      evidence: (evidenceByProposal.get(proposal.id) ?? [])
        .filter((item) => Number(item.proposal_version) === Number(proposal.version))
        .map((item) => ({
          key: item.evidence_key,
          sourceType: item.source_type,
          metricName: item.metric_name,
          metricValue: Number(item.metric_value),
          summary: item.summary,
          observedAt: item.observed_at,
        })),
    })),
  };
}

export async function generateSelfImprovementProposals(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...managerRoles]);
    const [workflows, connectors, duplicateContactPairs, websitePages, websiteHeroes] =
      await Promise.all([
        listWorkflowImprovementSignals(transaction, tenantId),
        listConnectorImprovementSignals(transaction, tenantId),
        countDuplicateContactPairs(transaction, tenantId),
        listWebsitePageImprovementSignals(transaction, tenantId),
        listWebsiteHeroImprovementSignals(transaction, tenantId),
      ]);
    const now = nowIso();
    const candidates = buildSelfImprovementCandidates(
      { workflows, connectors, duplicateContactPairs, websitePages, websiteHeroes },
      new Date(now),
    );
    const current = await listCurrentSelfImprovementProposals(transaction, tenantId);
    const currentByKey = new Map(current.map((item) => [item.proposal_key, item]));
    const detectedKeys = new Set(candidates.map((item) => item.proposalKey));
    let createdCount = 0;
    let unchangedCount = 0;
    let resolvedCount = 0;

    for (const candidate of candidates) {
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(candidate))
        .digest("hex");
      const existing = currentByKey.get(candidate.proposalKey);
      if (existing?.fingerprint === fingerprint) {
        unchangedCount += 1;
        continue;
      }
      if (existing) {
        const closed = await closeCurrentSelfImprovementProposal(transaction, {
          tenantId,
          proposalId: existing.id,
          status: "superseded",
          now,
        });
        if (!closed) {
          throw new SelfImprovementError(
            "self_improvement_conflict",
            "Cette proposition a déjà été actualisée.",
          );
        }
      }
      const version = await getNextSelfImprovementVersion(
        transaction,
        tenantId,
        candidate.proposalKey,
      );
      const proposalId = id("improvement");
      await insertSelfImprovementProposal(transaction, {
        id: proposalId,
        tenantId,
        ...candidate,
        fingerprint,
        version,
        supersedesId: existing?.id,
        createdBy: userId,
        now,
      });
      for (const evidence of candidate.evidence) {
        await insertSelfImprovementEvidence(transaction, {
          id: id("improvement_evidence"),
          tenantId,
          proposalId,
          proposalVersion: version,
          evidenceKey: evidence.key,
          sourceType: evidence.sourceType,
          sourceId: evidence.sourceId,
          metricName: evidence.metricName,
          metricValue: evidence.metricValue,
          summary: evidence.summary,
          observedAt: now,
        });
      }
      createdCount += 1;
    }

    for (const existing of current) {
      if (!detectedKeys.has(existing.proposal_key)) {
        const resolved = await closeCurrentSelfImprovementProposal(transaction, {
          tenantId,
          proposalId: existing.id,
          status: "resolved",
          now,
        });
        if (resolved) resolvedCount += 1;
      }
    }

    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "self_improvement.proposals_generated",
      targetType: "tenant",
      targetId: tenantId,
      metadata: {
        detectedCount: candidates.length,
        createdCount,
        unchangedCount,
        resolvedCount,
        customerContentStored: false,
        automaticChangeTriggered: false,
        externalActionTriggered: false,
      },
    });
    return { detectedCount: candidates.length, createdCount, unchangedCount, resolvedCount };
  });
}

export async function decideSelfImprovementProposal(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: SelfImprovementDecisionInput,
) {
  const parsed = selfImprovementDecisionSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...managerRoles]);
    const proposal = await findCurrentSelfImprovementProposal(
      transaction,
      tenantId,
      parsed.proposalId,
    );
    if (!proposal) {
      throw new SelfImprovementError(
        "self_improvement_not_found",
        "Cette proposition n'est plus disponible.",
      );
    }
    if (proposal.decision_status !== "pending") {
      throw new SelfImprovementError(
        "self_improvement_already_decided",
        "Cette proposition a déjà été décidée.",
      );
    }
    const now = nowIso();
    const updated = await updateSelfImprovementDecisionStatus(transaction, {
      tenantId,
      proposalId: proposal.id,
      decision: parsed.decision,
      now,
    });
    if (!updated) {
      throw new SelfImprovementError(
        "self_improvement_conflict",
        "Cette proposition a déjà été décidée.",
      );
    }
    await insertSelfImprovementDecision(transaction, {
      id: id("improvement_decision"),
      tenantId,
      proposalId: proposal.id,
      proposalVersion: Number(proposal.version),
      decision: parsed.decision,
      reason: parsed.reason,
      createdBy: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: `self_improvement.proposal_${parsed.decision}`,
      targetType: "self_improvement_proposal",
      targetId: proposal.id,
      metadata: {
        category: proposal.category,
        version: Number(proposal.version),
        planningOnly: true,
        automaticChangeTriggered: false,
        externalActionTriggered: false,
      },
    });
    return { proposalId: proposal.id, decision: parsed.decision, planningOnly: true as const };
  });
}
