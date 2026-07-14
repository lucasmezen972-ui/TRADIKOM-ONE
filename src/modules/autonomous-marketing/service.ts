import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { AutonomousMarketingError } from "@/modules/autonomous-marketing/errors";
import {
  decideMarketingApproval,
  decideMarketingProposalRecord,
  findMarketingProposal,
  findMarketingProposalByFingerprint,
  insertMarketingApproval,
  insertMarketingDecision,
  insertMarketingEvidence,
  insertMarketingProposal,
  listEvidenceForProposal,
  listMarketingEvidence,
  listMarketingProposals,
  submitMarketingProposal,
  supersedeMarketingApproval,
  supersedeMarketingProposal,
} from "@/modules/autonomous-marketing/repository";
import {
  autonomousMarketingGenerationVersion,
  buildMarketingProposalCandidates,
  fingerprintMarketingRevision,
} from "@/modules/autonomous-marketing/rules";
import {
  marketingProposalDecisionSchema,
  reviseMarketingProposalSchema,
  submitMarketingProposalSchema,
  type MarketingProposalDecisionInput,
  type ReviseMarketingProposalInput,
  type SubmitMarketingProposalInput,
} from "@/modules/autonomous-marketing/schemas";
import { getBusinessTwin } from "@/modules/business-twin";
import { assertTenantAccess } from "@/modules/tenants";

const marketingRoles = ["owner", "administrator", "manager"] as const;

export async function getAutonomousMarketing(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const [rows, evidenceRows] = await Promise.all([
    listMarketingProposals(db, tenantId),
    listMarketingEvidence(db, tenantId),
  ]);
  const evidenceByProposal = new Map<string, Array<{
    id: string;
    type: (typeof evidenceRows)[number]["evidence_type"];
    ref: string;
    label: string;
    observedValue: string;
    capturedAt: string;
  }>>();
  for (const evidence of evidenceRows) {
    const current = evidenceByProposal.get(evidence.proposal_id) ?? [];
    current.push({
      id: evidence.id,
      type: evidence.evidence_type,
      ref: evidence.evidence_ref,
      label: evidence.label,
      observedValue: evidence.observed_value,
      capturedAt: evidence.captured_at,
    });
    evidenceByProposal.set(evidence.proposal_id, current);
  }

  return rows.map((row) => ({
    id: row.id,
    campaignKey: row.campaign_key,
    channel: row.channel,
    title: row.title,
    subject: row.subject,
    objective: row.objective,
    audience: row.audience,
    content: row.content,
    callToAction: row.call_to_action,
    expectedOutcome: row.expected_outcome,
    riskSummary: row.risk_summary,
    budgetCents: row.budget_cents ?? undefined,
    startsAt: row.starts_at ?? undefined,
    endsAt: row.ends_at ?? undefined,
    status: row.status,
    version: row.version,
    generationVersion: row.generation_version,
    decidedBy: row.decided_by ?? undefined,
    decisionReason: row.decision_reason ?? undefined,
    decidedAt: row.decided_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    evidence: evidenceByProposal.get(row.id) ?? [],
  }));
}

export async function generateMarketingCampaignProposals(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...marketingRoles]);
    const profile = await getBusinessTwin(transaction, userId, tenantId);
    if (!profile) {
      throw new AutonomousMarketingError(
        "marketing_profile_required",
        "Complétez le Business Twin avant de préparer une campagne.",
      );
    }
    const candidates = buildMarketingProposalCandidates(tenantId, profile);
    const now = nowIso();
    const createdIds: string[] = [];

    for (const candidate of candidates) {
      const duplicate = await findMarketingProposalByFingerprint(
        transaction,
        tenantId,
        candidate.campaignKey,
        candidate.fingerprint,
      );
      if (duplicate) continue;
      const proposalId = id("marketing_proposal");
      await insertMarketingProposal(transaction, {
        id: proposalId,
        tenantId,
        ...candidate,
        version: 1,
        generationVersion: autonomousMarketingGenerationVersion,
        actorId: userId,
        now,
      });
      for (const evidence of candidate.evidence) {
        await insertMarketingEvidence(transaction, {
          id: id("marketing_evidence"),
          tenantId,
          proposalId,
          evidence,
          now,
        });
      }
      createdIds.push(proposalId);
    }

    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "autonomous_marketing.proposals_generated",
      targetType: "tenant",
      targetId: tenantId,
      metadata: {
        generationVersion: autonomousMarketingGenerationVersion,
        candidateCount: candidates.length,
        createdCount: createdIds.length,
        executionTriggered: false,
      },
    });
    return { createdIds, candidateCount: candidates.length };
  });
}

export async function submitMarketingProposalForApproval(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: SubmitMarketingProposalInput,
) {
  const parsed = submitMarketingProposalSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...marketingRoles]);
    const now = nowIso();
    const submitted = await submitMarketingProposal(
      transaction,
      tenantId,
      parsed.proposalId,
      now,
    );
    if (!submitted) {
      throw new AutonomousMarketingError(
        "marketing_proposal_not_draft",
        "Ce brouillon n'existe pas ou a déjà été soumis.",
      );
    }
    await insertMarketingApproval(transaction, {
      id: id("approval"),
      tenantId,
      actorId: userId,
      proposalId: parsed.proposalId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "autonomous_marketing.proposal_submitted",
      targetType: "marketing_campaign_proposal",
      targetId: parsed.proposalId,
      metadata: { executionTriggered: false },
    });
  });
}

export async function decideMarketingProposal(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: MarketingProposalDecisionInput,
) {
  const parsed = marketingProposalDecisionSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...marketingRoles]);
    const now = nowIso();
    const decided = await decideMarketingProposalRecord(transaction, {
      tenantId,
      proposalId: parsed.proposalId,
      decision: parsed.decision,
      reason: parsed.reason,
      actorId: userId,
      now,
    });
    if (!decided) {
      throw new AutonomousMarketingError(
        "marketing_proposal_not_pending",
        "Cette proposition n'existe pas ou n'attend plus de décision.",
      );
    }
    await decideMarketingApproval(
      transaction,
      tenantId,
      parsed.proposalId,
      parsed.decision,
    );
    await insertMarketingDecision(transaction, {
      id: id("marketing_decision"),
      tenantId,
      proposalId: parsed.proposalId,
      decision: parsed.decision,
      reason: parsed.reason,
      actorId: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: `autonomous_marketing.proposal_${parsed.decision}`,
      targetType: "marketing_campaign_proposal",
      targetId: parsed.proposalId,
      metadata: { executionTriggered: false },
    });
  });
}

export async function reviseMarketingProposal(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: ReviseMarketingProposalInput,
) {
  const parsed = reviseMarketingProposalSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...marketingRoles]);
    const current = await findMarketingProposal(
      transaction,
      tenantId,
      parsed.proposalId,
    );
    if (!current || ["superseded", "archived"].includes(current.status)) {
      throw new AutonomousMarketingError(
        "marketing_proposal_not_found",
        "Cette proposition marketing n'existe plus.",
      );
    }
    const evidence = await listEvidenceForProposal(
      transaction,
      tenantId,
      current.id,
    );
    if (evidence.length === 0) {
      throw new AutonomousMarketingError(
        "marketing_evidence_required",
        "La proposition ne peut pas être révisée sans preuve vérifiée.",
      );
    }
    const now = nowIso();
    const superseded = await supersedeMarketingProposal(
      transaction,
      tenantId,
      current.id,
      now,
    );
    if (!superseded) {
      throw new AutonomousMarketingError(
        "marketing_proposal_conflict",
        "La proposition a déjà été modifiée.",
      );
    }
    await supersedeMarketingApproval(transaction, tenantId, current.id);
    const proposalId = id("marketing_proposal");
    const version = current.version + 1;
    await insertMarketingProposal(transaction, {
      id: proposalId,
      tenantId,
      campaignKey: current.campaign_key,
      fingerprint: fingerprintMarketingRevision({
        campaignKey: current.campaign_key,
        version,
        title: parsed.title,
        subject: parsed.subject,
        objective: parsed.objective,
        audience: parsed.audience,
        content: parsed.content,
        callToAction: parsed.callToAction,
        expectedOutcome: parsed.expectedOutcome,
        riskSummary: parsed.riskSummary,
      }),
      channel: current.channel,
      title: parsed.title,
      subject: parsed.subject,
      objective: parsed.objective,
      audience: parsed.audience,
      content: parsed.content,
      callToAction: parsed.callToAction,
      expectedOutcome: parsed.expectedOutcome,
      riskSummary: parsed.riskSummary,
      budgetCents: parsed.budgetCents ?? null,
      startsAt: parsed.startsAt || null,
      endsAt: parsed.endsAt || null,
      version,
      supersedesId: current.id,
      sourceStrategyRecommendationId: current.source_strategy_recommendation_id,
      generationVersion: current.generation_version,
      actorId: userId,
      now,
    });
    for (const item of evidence) {
      await insertMarketingEvidence(transaction, {
        id: id("marketing_evidence"),
        tenantId,
        proposalId,
        evidence: {
          type: item.evidence_type,
          ref: item.evidence_ref,
          label: item.label,
          observedValue: item.observed_value,
        },
        now,
      });
    }
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "autonomous_marketing.proposal_revised",
      targetType: "marketing_campaign_proposal",
      targetId: proposalId,
      metadata: {
        supersedesId: current.id,
        version,
        executionTriggered: false,
      },
    });
    return { proposalId, version };
  });
}
