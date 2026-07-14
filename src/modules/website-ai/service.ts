import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { assertTenantAccess } from "@/modules/tenants";
import { WebsiteAiError } from "@/modules/website-ai/errors";
import {
  decideWebsiteAiApproval,
  decideWebsiteAiProposalRecord,
  findApprovedWebsiteAiProposal,
  findWebsiteAiProposalByFingerprint,
  getNextWebsiteAiProposalVersion,
  insertWebsiteAiApproval,
  insertWebsiteAiDecision,
  insertWebsiteAiEvidence,
  insertWebsiteAiProposal,
  listWebsiteAiEvidence,
  listWebsiteAiProposals,
  markWebsiteAiProposalApplied,
  markWebsiteAiProposalStale,
  submitWebsiteAiProposal,
  supersedeOpenWebsiteAiProposals,
  supersedeWebsiteAiApproval,
} from "@/modules/website-ai/repository";
import {
  buildWebsiteAiProposalCandidates,
  hashWebsiteSectionContent,
  websiteAiGenerationVersion,
} from "@/modules/website-ai/rules";
import {
  websiteAiProposalDecisionSchema,
  websiteAiProposalReferenceSchema,
  type WebsiteAiProposalDecisionInput,
  type WebsiteAiProposalReferenceInput,
} from "@/modules/website-ai/schemas";
import {
  getWebsiteWorkspace,
  updateWebsiteSection,
} from "@/modules/websites";

const websiteAiRoles = ["owner", "administrator", "manager"] as const;

export async function getWebsiteAiWorkspace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const [rows, evidenceRows] = await Promise.all([
    listWebsiteAiProposals(db, tenantId),
    listWebsiteAiEvidence(db, tenantId),
  ]);
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
  return rows.map((row) => ({
    id: row.id,
    websiteId: row.website_id,
    sectionId: row.section_id,
    proposalKey: row.proposal_key,
    proposalType: row.proposal_type,
    title: row.title,
    rationale: row.rationale,
    expectedGain: row.expected_gain,
    riskSummary: row.risk_summary,
    proposedTitle: row.proposed_title,
    proposedBody: row.proposed_body,
    status: row.status,
    version: row.version,
    decisionReason: row.decision_reason ?? undefined,
    decidedAt: row.decided_at ?? undefined,
    appliedAt: row.applied_at ?? undefined,
    createdAt: row.created_at,
    evidence: evidenceByProposal.get(row.id) ?? [],
  }));
}

export async function generateWebsiteAiProposals(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...websiteAiRoles]);
    const workspace = await getWebsiteWorkspace(transaction, userId, tenantId);
    if (!workspace.website || !workspace.profile) {
      throw new WebsiteAiError(
        "website_ai_source_required",
        "Un site et un Business Twin vérifiés sont nécessaires.",
      );
    }
    const candidates = buildWebsiteAiProposalCandidates({
      profile: workspace.profile,
      website: workspace.website,
      sections: workspace.sections,
    });
    const now = nowIso();
    const createdIds: string[] = [];
    for (const candidate of candidates) {
      const duplicate = await findWebsiteAiProposalByFingerprint(
        transaction,
        tenantId,
        candidate.proposalKey,
        candidate.fingerprint,
      );
      if (duplicate) continue;
      const superseded = await supersedeOpenWebsiteAiProposals(
        transaction,
        tenantId,
        candidate.proposalKey,
        now,
      );
      for (const item of superseded) {
        await supersedeWebsiteAiApproval(transaction, tenantId, item.id);
      }
      const proposalId = id("website_ai_proposal");
      await insertWebsiteAiProposal(transaction, {
        id: proposalId,
        tenantId,
        ...candidate,
        version: await getNextWebsiteAiProposalVersion(
          transaction,
          tenantId,
          candidate.proposalKey,
        ),
        supersedesId: superseded[0]?.id,
        generationVersion: websiteAiGenerationVersion,
        actorId: userId,
        now,
      });
      for (const evidence of candidate.evidence) {
        await insertWebsiteAiEvidence(transaction, {
          id: id("website_ai_evidence"),
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
      action: "website_ai.proposals_generated",
      targetType: "website",
      targetId: workspace.website.id,
      metadata: {
        candidateCount: candidates.length,
        createdCount: createdIds.length,
        generationVersion: websiteAiGenerationVersion,
        publicationTriggered: false,
      },
    });
    return { createdIds, candidateCount: candidates.length };
  });
}

export async function submitWebsiteAiProposalForApproval(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: WebsiteAiProposalReferenceInput,
) {
  const parsed = websiteAiProposalReferenceSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...websiteAiRoles]);
    const now = nowIso();
    const submitted = await submitWebsiteAiProposal(
      transaction,
      tenantId,
      parsed.proposalId,
      now,
    );
    if (!submitted) {
      throw new WebsiteAiError(
        "website_ai_proposal_not_proposed",
        "Cette proposition n'est plus disponible.",
      );
    }
    await insertWebsiteAiApproval(transaction, {
      id: id("approval"),
      tenantId,
      proposalId: parsed.proposalId,
      actorId: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "website_ai.proposal_submitted",
      targetType: "website_ai_proposal",
      targetId: parsed.proposalId,
      metadata: { publicationTriggered: false },
    });
  });
}

export async function decideWebsiteAiProposal(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: WebsiteAiProposalDecisionInput,
) {
  const parsed = websiteAiProposalDecisionSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...websiteAiRoles]);
    const now = nowIso();
    const decided = await decideWebsiteAiProposalRecord(transaction, {
      tenantId,
      proposalId: parsed.proposalId,
      decision: parsed.decision,
      reason: parsed.reason,
      actorId: userId,
      now,
    });
    if (!decided) {
      throw new WebsiteAiError(
        "website_ai_proposal_not_pending",
        "Cette proposition n'attend plus de décision.",
      );
    }
    await decideWebsiteAiApproval(
      transaction,
      tenantId,
      parsed.proposalId,
      parsed.decision,
    );
    await insertWebsiteAiDecision(transaction, {
      id: id("website_ai_decision"),
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
      action: `website_ai.proposal_${parsed.decision}`,
      targetType: "website_ai_proposal",
      targetId: parsed.proposalId,
      metadata: { publicationTriggered: false },
    });
  });
}

export async function applyApprovedWebsiteAiProposal(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: WebsiteAiProposalReferenceInput,
) {
  const parsed = websiteAiProposalReferenceSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...websiteAiRoles]);
    const proposal = await findApprovedWebsiteAiProposal(
      transaction,
      tenantId,
      parsed.proposalId,
    );
    if (!proposal) {
      throw new WebsiteAiError(
        "website_ai_proposal_not_approved",
        "Cette proposition n'est pas approuvée.",
      );
    }
    const workspace = await getWebsiteWorkspace(transaction, userId, tenantId);
    const section = workspace.sections.find((item) => item.id === proposal.section_id);
    if (!section || hashWebsiteSectionContent(section) !== proposal.original_content_hash) {
      const now = nowIso();
      await markWebsiteAiProposalStale(transaction, tenantId, proposal.id, now);
      await recordAuditLog(transaction, {
        tenantId,
        actorId: userId,
        action: "website_ai.proposal_stale",
        targetType: "website_ai_proposal",
        targetId: proposal.id,
        metadata: { publicationTriggered: false },
      });
      return { applied: false, stale: true };
    }

    await updateWebsiteSection(transaction, userId, tenantId, section.id, {
      title: proposal.proposed_title,
      body: proposal.proposed_body,
      imageUrl: section.imageUrl,
      buttonLabel: section.buttonLabel,
      buttonHref: section.buttonHref,
      enabled: section.enabled,
    });
    const now = nowIso();
    const applied = await markWebsiteAiProposalApplied(transaction, {
      tenantId,
      proposalId: proposal.id,
      actorId: userId,
      now,
    });
    if (!applied) {
      throw new WebsiteAiError(
        "website_ai_proposal_conflict",
        "Cette proposition a déjà été appliquée.",
      );
    }
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "website_ai.proposal_applied_to_draft",
      targetType: "website_ai_proposal",
      targetId: proposal.id,
      metadata: {
        websiteId: proposal.website_id,
        sectionId: proposal.section_id,
        publicationTriggered: false,
      },
    });
    return { applied: true, stale: false };
  });
}
