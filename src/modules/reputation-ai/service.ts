import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { hashToken, id, nowIso, toJson } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { ReputationAiError } from "@/modules/reputation-ai/errors";
import {
  decideReputationApproval,
  decideReputationProposalRecord,
  findReputationProposalByFingerprint,
  findReputationReviewByHash,
  getNextReputationProposalVersion,
  insertReputationApproval,
  insertReputationDecision,
  insertReputationEvidence,
  insertReputationProposal,
  insertReputationReview,
  listReputationEvidence,
  listReputationProposals,
  listReputationReviews,
  submitReputationProposal,
  supersedeOpenReputationProposals,
  supersedeReputationApproval,
} from "@/modules/reputation-ai/repository";
import {
  buildReputationProposalCandidate,
  reputationGenerationVersion,
} from "@/modules/reputation-ai/rules";
import {
  reputationProposalDecisionSchema,
  reputationProposalReferenceSchema,
  reputationReviewSchema,
  type ReputationProposalDecisionInput,
  type ReputationProposalReferenceInput,
  type ReputationReviewInput,
} from "@/modules/reputation-ai/schemas";
import { assertTenantAccess } from "@/modules/tenants";

const reputationManageRoles = ["owner", "administrator", "manager"] as const;

export async function getReputationWorkspace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const [reviews, proposals, evidenceRows] = await Promise.all([
    listReputationReviews(db, tenantId),
    listReputationProposals(db, tenantId),
    listReputationEvidence(db, tenantId),
  ]);
  const reviewsById = new Map(reviews.map((review) => [review.id, review]));
  const evidenceByProposal = new Map<string, Array<{
    id: string;
    type: (typeof evidenceRows)[number]["evidence_type"];
    ref: string;
    label: string;
    observedValue: string;
  }>>();
  for (const evidence of evidenceRows) {
    const current = evidenceByProposal.get(evidence.proposal_id) ?? [];
    current.push({
      id: evidence.id,
      type: evidence.evidence_type,
      ref: evidence.evidence_ref,
      label: evidence.label,
      observedValue: evidence.observed_value,
    });
    evidenceByProposal.set(evidence.proposal_id, current);
  }

  return {
    reviews: reviews.map((review) => ({
      id: review.id,
      source: review.source,
      externalRef: review.external_ref ?? undefined,
      reviewerAlias: review.reviewer_alias ?? undefined,
      rating: review.rating ?? undefined,
      reviewText: review.review_text,
      occurredAt: review.occurred_at,
      createdAt: review.created_at,
    })),
    proposals: proposals.map((proposal) => {
      const review = reviewsById.get(proposal.review_id);
      return {
        id: proposal.id,
        reviewId: proposal.review_id,
        source: review?.source ?? "manual_import",
        reviewerAlias: review?.reviewer_alias ?? undefined,
        rating: review?.rating ?? undefined,
        reviewText: review?.review_text ?? "Avis indisponible.",
        sentiment: proposal.sentiment,
        confidence: Number(proposal.confidence),
        riskLevel: proposal.risk_level,
        authenticityStatus: proposal.authenticity_status,
        rationale: proposal.rationale,
        responseDraft: proposal.response_draft,
        improvementPlan: proposal.improvement_plan,
        status: proposal.status,
        version: Number(proposal.version),
        decisionReason: proposal.decision_reason ?? undefined,
        decidedAt: proposal.decided_at ?? undefined,
        createdAt: proposal.created_at,
        evidence: evidenceByProposal.get(proposal.id) ?? [],
      };
    }),
  };
}

export async function createReputationReview(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: ReputationReviewInput,
) {
  const parsed = reputationReviewSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...reputationManageRoles,
    ]);
    const occurredAt = new Date(parsed.occurredAt).toISOString();
    const contentHash = hashToken(
      toJson({
        source: parsed.source,
        externalRef: parsed.externalRef ?? null,
        reviewerAlias: parsed.reviewerAlias ?? null,
        rating: parsed.rating ?? null,
        reviewText: parsed.reviewText,
        occurredAt,
      }),
    );
    if (await findReputationReviewByHash(transaction, tenantId, contentHash)) {
      throw new ReputationAiError(
        "reputation_review_duplicate",
        "Cet avis a déjà été importé.",
      );
    }
    const reviewId = id("reputation_review");
    const now = nowIso();
    await insertReputationReview(transaction, {
      id: reviewId,
      tenantId,
      source: parsed.source,
      externalRef: parsed.externalRef ?? null,
      reviewerAlias: parsed.reviewerAlias ?? null,
      rating: parsed.rating ?? null,
      reviewText: parsed.reviewText,
      contentHash,
      occurredAt,
      actorId: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "reputation.review_imported",
      targetType: "reputation_review",
      targetId: reviewId,
      metadata: {
        source: parsed.source,
        ratingProvided: parsed.rating != null,
        reviewTextLength: parsed.reviewText.length,
        externalFetchTriggered: false,
      },
    });
    return { reviewId };
  });
}

export async function generateReputationProposals(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...reputationManageRoles,
    ]);
    const reviews = await listReputationReviews(transaction, tenantId);
    const now = nowIso();
    const createdIds: string[] = [];
    let supersededCount = 0;
    for (const review of reviews) {
      const candidate = buildReputationProposalCandidate(review);
      const duplicate = await findReputationProposalByFingerprint(
        transaction,
        tenantId,
        review.id,
        candidate.fingerprint,
      );
      if (duplicate) continue;
      const superseded = await supersedeOpenReputationProposals(
        transaction,
        tenantId,
        review.id,
        now,
      );
      for (const proposal of superseded) {
        await supersedeReputationApproval(transaction, tenantId, proposal.id);
      }
      supersededCount += superseded.length;
      const proposalId = id("reputation_proposal");
      await insertReputationProposal(transaction, {
        id: proposalId,
        tenantId,
        reviewId: review.id,
        fingerprint: candidate.fingerprint,
        sentiment: candidate.sentiment,
        confidence: candidate.confidence,
        riskLevel: candidate.riskLevel,
        rationale: candidate.rationale,
        responseDraft: candidate.responseDraft,
        improvementPlan: candidate.improvementPlan,
        version: await getNextReputationProposalVersion(
          transaction,
          tenantId,
          review.id,
        ),
        supersedesId: superseded[0]?.id,
        generationVersion: reputationGenerationVersion,
        actorId: userId,
        now,
      });
      for (const evidence of candidate.evidence) {
        await insertReputationEvidence(transaction, {
          id: id("reputation_evidence"),
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
      action: "reputation.proposals_generated",
      targetType: "tenant",
      targetId: tenantId,
      metadata: {
        reviewCount: reviews.length,
        createdCount: createdIds.length,
        supersededCount,
        generationVersion: reputationGenerationVersion,
        authenticityAssessed: false,
        externalActionTriggered: false,
        publicationTriggered: false,
      },
    });
    return { createdIds, reviewCount: reviews.length, supersededCount };
  });
}

export async function submitReputationProposalForApproval(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: ReputationProposalReferenceInput,
) {
  const parsed = reputationProposalReferenceSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...reputationManageRoles,
    ]);
    const now = nowIso();
    const submitted = await submitReputationProposal(
      transaction,
      tenantId,
      parsed.proposalId,
      now,
    );
    if (!submitted) {
      throw new ReputationAiError(
        "reputation_proposal_not_proposed",
        "Cette proposition n'est plus disponible.",
      );
    }
    await insertReputationApproval(transaction, {
      id: id("approval"),
      tenantId,
      proposalId: parsed.proposalId,
      actorId: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "reputation.proposal_submitted",
      targetType: "reputation_response",
      targetId: parsed.proposalId,
      metadata: { publicationTriggered: false, externalActionTriggered: false },
    });
  });
}

export async function decideReputationProposal(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: ReputationProposalDecisionInput,
) {
  const parsed = reputationProposalDecisionSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...reputationManageRoles,
    ]);
    const now = nowIso();
    const decided = await decideReputationProposalRecord(transaction, {
      tenantId,
      proposalId: parsed.proposalId,
      decision: parsed.decision,
      reason: parsed.reason,
      actorId: userId,
      now,
    });
    if (!decided) {
      throw new ReputationAiError(
        "reputation_proposal_not_pending",
        "Cette proposition n'attend plus de décision.",
      );
    }
    await decideReputationApproval(
      transaction,
      tenantId,
      parsed.proposalId,
      parsed.decision,
    );
    await insertReputationDecision(transaction, {
      id: id("reputation_decision"),
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
      action: `reputation.proposal_${parsed.decision}`,
      targetType: "reputation_response",
      targetId: parsed.proposalId,
      metadata: {
        publicationTriggered: false,
        externalActionTriggered: false,
      },
    });
  });
}
