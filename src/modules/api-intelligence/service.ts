import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { withTenantDbTransaction } from "@/db/tenant-context";
import { recordAuditLog } from "@/modules/audit";
import {
  AnalyzerError,
  openApiPreviewSchema,
  previewOpenApiDocument,
  type OpenApiPreview,
} from "@/modules/api-intelligence/analyzer";
import {
  findApiClaimById,
  replaceOpenApiImport,
  setApiClaimDecision,
} from "@/modules/api-intelligence/repository";
import { assertPlatformAdmin } from "@/modules/platform-admin";
import {
  findApiProductById,
  findApiSnapshotById,
  findApiSourceById,
  updateApiProductFromSpecification,
} from "@/modules/software-directory";

export async function previewOpenApiSnapshot(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { snapshotId: string; apiProductId: string },
) {
  await assertPlatformAdmin(db, userId, tenantId);
  const snapshot = await findApiSnapshotById(db, input.snapshotId);
  if (!snapshot) {
    throw new AnalyzerError("snapshot_not_found", "Snapshot source introuvable.");
  }
  const source = await findApiSourceById(db, snapshot.source_id);
  if (!source || source.api_product_id !== input.apiProductId) {
    throw new AnalyzerError(
      "openapi_invalid",
      "Le snapshot ne correspond pas au produit API.",
    );
  }
  if (!(await findApiProductById(db, input.apiProductId))) {
    throw new AnalyzerError("openapi_invalid", "Produit API introuvable.");
  }
  return previewOpenApiDocument({
    snapshotId: snapshot.id,
    apiProductId: input.apiProductId,
    sourceHash: snapshot.content_hash,
    content: snapshot.content,
    contentType: snapshot.content_type,
  });
}

export async function persistOpenApiPreview(
  db: DbClient,
  userId: string,
  tenantId: string,
  submittedPreview: OpenApiPreview,
) {
  const parsed = openApiPreviewSchema.parse(submittedPreview);
  const authoritative = await previewOpenApiSnapshot(db, userId, tenantId, {
    snapshotId: parsed.snapshotId,
    apiProductId: parsed.apiProductId,
  });
  if (JSON.stringify(authoritative) !== JSON.stringify(parsed)) {
    throw new AnalyzerError(
      "preview_required",
      "L'apercu OpenAPI a change et doit etre revalide.",
    );
  }
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const importedAt = nowIso();
    await updateApiProductFromSpecification(transaction, {
      apiProductId: parsed.apiProductId,
      baseUrl: parsed.baseUrl,
      authenticationType: parsed.authenticationType,
      oauthMetadata: parsed.oauthMetadata,
      scopes: parsed.scopes,
      webhookSupport: parsed.webhookSupport,
      rateLimitInformation: {
        fingerprint: parsed.rateLimitFingerprint,
        locators: parsed.rateLimitLocators,
      },
      confidenceScore: 80,
      verifiedAt: importedAt,
    });
    const imported = await replaceOpenApiImport(transaction, parsed, {
      createdAt: importedAt,
      createdBy: userId,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "api_intelligence.openapi_imported",
      targetType: "api_product",
      targetId: parsed.apiProductId,
      metadata: {
        snapshotId: parsed.snapshotId,
        sourceHash: parsed.sourceHash,
        operationCount: parsed.operations.length,
        schemaCount: parsed.schemas.length,
      },
    });
    return {
      apiProductId: parsed.apiProductId,
      operationCount: parsed.operations.length,
      schemaCount: parsed.schemas.length,
      schemaEvidence: Object.fromEntries(imported.schemaEvidence),
      schemaClaims: Object.fromEntries(imported.schemaClaims),
      claimIds: imported.claimIds,
    };
  });
}

export async function decideApiClaim(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: {
    claimId: string;
    status: "approved" | "rejected";
    reason: string;
  },
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const claim = await findApiClaimById(transaction, input.claimId);
    if (!claim) {
      throw new AnalyzerError("claim_not_found", "Claim API introuvable.");
    }
    const decidedAt = nowIso();
    await setApiClaimDecision(transaction, {
      decisionId: id("verification"),
      claimId: input.claimId,
      status: input.status,
      reason: input.reason,
      decidedBy: userId,
      decidedAt,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: `api_intelligence.claim_${input.status}`,
      targetType: "api_claim",
      targetId: input.claimId,
      metadata: {
        subjectType: claim.subject_type,
        subjectId: claim.subject_id,
      },
    });
    return { claimId: input.claimId, status: input.status };
  });
}
