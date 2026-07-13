import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { withTenantDbTransaction } from "@/db/tenant-context";
import { recordAuditLog } from "@/modules/audit";
import {
  AnalyzerError,
  type ApiContractPreview,
  graphQlPreviewSchema,
  openApiPreviewSchema,
  postmanPreviewSchema,
  previewOpenApiDocument,
  previewGraphQlDocument,
  previewPostmanCollection,
  type GraphQlPreview,
  type OpenApiPreview,
  type PostmanPreview,
} from "@/modules/api-intelligence/analyzer";
import {
  findApiClaimById,
  listApiProductImportSourceTypes,
  replaceOpenApiImport,
  replaceGraphQlImport,
  replacePostmanImport,
  setApiClaimDecision,
} from "@/modules/api-intelligence/repository";
import { assertPlatformAdmin } from "@/modules/platform-admin";
import {
  findApiProductById,
  findApiSnapshotById,
  findApiSourceById,
  updateApiProductFromSpecification,
  updateApiProductFromGraphQlSchema,
  updateApiProductFromPostmanCollection,
} from "@/modules/software-directory";

const openApiSourceType = "official_openapi_specification";
const postmanSourceType = "official_postman_collection";
const graphQlSourceType = "official_graphql_schema";

export async function previewOpenApiSnapshot(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { snapshotId: string; apiProductId: string },
) {
  await assertPlatformAdmin(db, userId, tenantId);
  const { snapshot } = await loadSnapshotContext(db, input, openApiSourceType);
  return previewOpenApiDocument({
    snapshotId: snapshot.id,
    apiProductId: input.apiProductId,
    sourceHash: snapshot.content_hash,
    content: snapshot.content,
    contentType: snapshot.content_type,
  });
}

export async function previewPostmanSnapshot(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { snapshotId: string; apiProductId: string },
) {
  await assertPlatformAdmin(db, userId, tenantId);
  const { snapshot } = await loadSnapshotContext(db, input, postmanSourceType);
  return previewPostmanCollection({
    snapshotId: snapshot.id,
    apiProductId: input.apiProductId,
    sourceHash: snapshot.content_hash,
    content: snapshot.content,
  });
}

export async function previewGraphQlSnapshot(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { snapshotId: string; apiProductId: string },
) {
  await assertPlatformAdmin(db, userId, tenantId);
  const { snapshot } = await loadSnapshotContext(db, input, graphQlSourceType);
  const product = await findApiProductById(db, input.apiProductId);
  if (!product) {
    throw new AnalyzerError("graphql_invalid", "Produit API introuvable.");
  }
  return previewGraphQlDocument({
    snapshotId: snapshot.id,
    apiProductId: input.apiProductId,
    sourceHash: snapshot.content_hash,
    content: snapshot.content,
    title: product.name,
    version: product.version,
  });
}

export async function previewApiSnapshot(
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
  if (source?.source_type === openApiSourceType) {
    return previewOpenApiSnapshot(db, userId, tenantId, input);
  }
  if (source?.source_type === postmanSourceType) {
    return previewPostmanSnapshot(db, userId, tenantId, input);
  }
  if (source?.source_type === graphQlSourceType) {
    return previewGraphQlSnapshot(db, userId, tenantId, input);
  }
  throw new AnalyzerError(
    "openapi_unsupported",
    "Ce type de source n'est pas encore importable.",
  );
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
  const { source } = await loadSnapshotContext(
    db,
    parsed,
    openApiSourceType,
  );
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    await assertCompatibleImportSource(
      transaction,
      parsed.apiProductId,
      openApiSourceType,
    );
    const importedAt = nowIso();
    await updateApiProductFromSpecification(transaction, {
      apiProductId: parsed.apiProductId,
      sourceUrl: source.canonical_url,
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

export async function persistPostmanPreview(
  db: DbClient,
  userId: string,
  tenantId: string,
  submittedPreview: PostmanPreview,
) {
  const parsed = postmanPreviewSchema.parse(submittedPreview);
  const authoritative = await previewPostmanSnapshot(db, userId, tenantId, {
    snapshotId: parsed.snapshotId,
    apiProductId: parsed.apiProductId,
  });
  if (JSON.stringify(authoritative) !== JSON.stringify(parsed)) {
    throw new AnalyzerError(
      "preview_required",
      "L'apercu Postman a change et doit etre revalide.",
    );
  }
  const { source } = await loadSnapshotContext(db, parsed, postmanSourceType);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    await assertCompatibleImportSource(
      transaction,
      parsed.apiProductId,
      postmanSourceType,
    );
    const importedAt = nowIso();
    await updateApiProductFromPostmanCollection(transaction, {
      apiProductId: parsed.apiProductId,
      sourceUrl: source.canonical_url,
      baseUrl: parsed.baseUrl,
      authenticationType: parsed.authenticationType,
      oauthMetadata: parsed.oauthMetadata,
      scopes: parsed.scopes,
      confidenceScore: 75,
      verifiedAt: importedAt,
    });
    const imported = await replacePostmanImport(transaction, parsed, {
      createdAt: importedAt,
      createdBy: userId,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "api_intelligence.postman_imported",
      targetType: "api_product",
      targetId: parsed.apiProductId,
      metadata: {
        snapshotId: parsed.snapshotId,
        sourceHash: parsed.sourceHash,
        operationCount: parsed.operations.length,
        variableCount: parsed.variables.length,
        exampleCount: parsed.examples.length,
        blockedScriptCount: parsed.blockedScriptCount,
      },
    });
    return {
      apiProductId: parsed.apiProductId,
      operationCount: parsed.operations.length,
      schemaCount: 0,
      blockedScriptCount: parsed.blockedScriptCount,
      schemaEvidence: {},
      schemaClaims: {},
      claimIds: imported.claimIds,
    };
  });
}

export async function persistGraphQlPreview(
  db: DbClient,
  userId: string,
  tenantId: string,
  submittedPreview: GraphQlPreview,
) {
  const parsed = graphQlPreviewSchema.parse(submittedPreview);
  const authoritative = await previewGraphQlSnapshot(db, userId, tenantId, {
    snapshotId: parsed.snapshotId,
    apiProductId: parsed.apiProductId,
  });
  if (JSON.stringify(authoritative) !== JSON.stringify(parsed)) {
    throw new AnalyzerError(
      "preview_required",
      "L'apercu GraphQL a change et doit etre revalide.",
    );
  }
  const { source } = await loadSnapshotContext(db, parsed, graphQlSourceType);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    await assertCompatibleImportSource(
      transaction,
      parsed.apiProductId,
      graphQlSourceType,
    );
    const importedAt = nowIso();
    await updateApiProductFromGraphQlSchema(transaction, {
      apiProductId: parsed.apiProductId,
      sourceUrl: source.canonical_url,
      confidenceScore: parsed.sourceFormat === "introspection" ? 80 : 75,
      verifiedAt: importedAt,
    });
    const imported = await replaceGraphQlImport(transaction, parsed, {
      createdAt: importedAt,
      createdBy: userId,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "api_intelligence.graphql_imported",
      targetType: "api_product",
      targetId: parsed.apiProductId,
      metadata: {
        snapshotId: parsed.snapshotId,
        sourceHash: parsed.sourceHash,
        sourceFormat: parsed.sourceFormat,
        operationCount: parsed.operations.length,
        schemaCount: parsed.schemas.length,
        redactedDefaultValueCount: parsed.redactedDefaultValueCount,
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

export function persistApiPreview(
  db: DbClient,
  userId: string,
  tenantId: string,
  preview: ApiContractPreview,
) {
  if (preview.parserVersion === "postman-1") {
    return persistPostmanPreview(db, userId, tenantId, preview);
  }
  if (preview.parserVersion === "graphql-1") {
    return persistGraphQlPreview(db, userId, tenantId, preview);
  }
  return persistOpenApiPreview(db, userId, tenantId, preview);
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

async function loadSnapshotContext(
  db: DbClient,
  input: { snapshotId: string; apiProductId: string },
  expectedSourceType: string,
) {
  const snapshot = await findApiSnapshotById(db, input.snapshotId);
  if (!snapshot) {
    throw new AnalyzerError("snapshot_not_found", "Snapshot source introuvable.");
  }
  const source = await findApiSourceById(db, snapshot.source_id);
  if (
    !source ||
    source.api_product_id !== input.apiProductId ||
    source.source_type !== expectedSourceType
  ) {
    throw new AnalyzerError(
      expectedSourceType === postmanSourceType
        ? "postman_invalid"
        : expectedSourceType === graphQlSourceType
          ? "graphql_invalid"
          : "openapi_invalid",
      "Le snapshot ne correspond pas au produit et au type de source attendus.",
    );
  }
  if (!(await findApiProductById(db, input.apiProductId))) {
    throw new AnalyzerError("openapi_invalid", "Produit API introuvable.");
  }
  return { snapshot, source };
}

async function assertCompatibleImportSource(
  db: DbClient,
  apiProductId: string,
  expectedSourceType: string,
) {
  const sourceTypes = await listApiProductImportSourceTypes(db, apiProductId);
  if (sourceTypes.some((sourceType) => sourceType !== expectedSourceType)) {
    throw new AnalyzerError(
      "source_type_conflict",
      "Ce produit contient deja un import d'un autre format.",
    );
  }
}
