import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { withTenantDbTransaction } from "@/db/tenant-context";
import { recordAuditLog } from "@/modules/audit";
import { AnalyzerError } from "@/modules/api-intelligence/analyzer";
import { findSchemaEvidence } from "@/modules/api-intelligence/repository";
import { OntologyError } from "@/modules/api-intelligence/ontology/errors";
import {
  findApprovedGlobalMapping,
  findGlobalMappingByShape,
  findPromotableTenantMapping,
  findTenantMappingByShape,
  findTenantOntologyMapping,
  insertGlobalOntologyMapping,
  insertTenantOntologyMapping,
  setTenantMappingApproval,
} from "@/modules/api-intelligence/ontology/repository";
import {
  globalMappingPromotionSchema,
  globalMappingReuseSchema,
  ontologyMappingInputSchema,
  type OntologyMappingInput,
} from "@/modules/api-intelligence/ontology/schemas";
import { assertPlatformAdmin } from "@/modules/platform-admin";

export async function proposeTenantOntologyMapping(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: OntologyMappingInput,
) {
  const parsed = ontologyMappingInputSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const expectedEvidence = await findSchemaEvidence(
      transaction,
      parsed.apiProductId,
      parsed.sourceEntity,
    );
    if (!expectedEvidence || expectedEvidence !== parsed.evidenceId) {
      throw new AnalyzerError(
        "openapi_invalid",
        "La correspondance doit citer le schema importe.",
      );
    }
    const mappingId = id("mapping");
    await insertTenantOntologyMapping(transaction, {
      ...parsed,
      id: mappingId,
      tenantId,
      createdBy: userId,
      createdAt: nowIso(),
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "api_intelligence.mapping_proposed",
      targetType: "api_tenant_mapping",
      targetId: mappingId,
      metadata: {
        sourceEntity: parsed.sourceEntity,
        canonicalEntity: parsed.canonicalEntity,
      },
    });
    return { mappingId, status: "pending" as const };
  });
}

export async function decideTenantOntologyMapping(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { mappingId: string; status: "approved" | "rejected" },
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const mapping = await findTenantOntologyMapping(
      transaction,
      tenantId,
      input.mappingId,
    );
    if (!mapping) {
      throw new AnalyzerError("openapi_invalid", "Correspondance introuvable.");
    }
    await setTenantMappingApproval(transaction, {
      tenantId,
      mappingId: input.mappingId,
      status: input.status,
      approvedBy: userId,
      updatedAt: nowIso(),
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: `api_intelligence.mapping_${input.status}`,
      targetType: "api_tenant_mapping",
      targetId: input.mappingId,
      metadata: { sourceEntity: mapping.source_entity },
    });
    return { mappingId: input.mappingId, status: input.status };
  });
}

export async function promoteApprovedTenantMapping(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: unknown,
) {
  const parsed = globalMappingPromotionSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const mapping = await findPromotableTenantMapping(
      transaction,
      tenantId,
      parsed.mappingId,
    );
    if (!mapping) {
      throw new OntologyError(
        "mapping_not_found",
        "Correspondance tenant introuvable.",
      );
    }
    if (mapping.approval_status !== "approved") {
      throw new OntologyError(
        "mapping_not_approved",
        "La correspondance tenant doit etre approuvee.",
      );
    }
    if (
      mapping.evidence_claim_status !== "approved" ||
      mapping.source_classification !== "official"
    ) {
      throw new OntologyError(
        "mapping_evidence_invalid",
        "La preuve officielle approuvee est requise.",
      );
    }

    const existing = await findGlobalMappingByShape(transaction, mapping);
    const promotedAt = nowIso();
    const globalMappingId = existing?.id ?? id("global_mapping");
    if (!existing) {
      await insertGlobalOntologyMapping(transaction, {
        id: globalMappingId,
        mapping,
        reason: parsed.reason,
        approvedBy: userId,
        createdAt: promotedAt,
      });
    }
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: existing
        ? "api_intelligence.global_mapping_reused"
        : "api_intelligence.global_mapping_promoted",
      targetType: "api_global_mapping",
      targetId: globalMappingId,
      metadata: {
        apiProductId: mapping.api_product_id,
        sourceEntity: mapping.source_entity,
        canonicalEntity: mapping.canonical_entity,
        copiedTenantData: false,
      },
    });
    return {
      globalMappingId,
      status: "approved" as const,
      created: !existing,
    };
  });
}

export async function proposeTenantMappingFromGlobal(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: unknown,
) {
  const parsed = globalMappingReuseSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const globalMapping = await findApprovedGlobalMapping(
      transaction,
      parsed.globalMappingId,
    );
    if (!globalMapping) {
      throw new OntologyError(
        "global_mapping_not_found",
        "Modele global approuve introuvable.",
      );
    }
    if (
      globalMapping.evidence_claim_status !== "approved" ||
      globalMapping.source_classification !== "official"
    ) {
      throw new OntologyError(
        "mapping_evidence_invalid",
        "La preuve du modele global n'est plus approuvee.",
      );
    }
    if (
      await findTenantMappingByShape(transaction, tenantId, globalMapping)
    ) {
      throw new OntologyError(
        "mapping_already_exists",
        "Cette correspondance existe deja pour l'organisation.",
      );
    }

    const mappingId = id("mapping");
    const proposedAt = nowIso();
    await insertTenantOntologyMapping(transaction, {
      id: mappingId,
      tenantId,
      apiProductId: globalMapping.api_product_id,
      sourceEntity: globalMapping.source_entity,
      canonicalEntity: globalMapping.canonical_entity,
      ...(globalMapping.source_field
        ? { sourceField: globalMapping.source_field }
        : {}),
      ...(globalMapping.canonical_field
        ? { canonicalField: globalMapping.canonical_field }
        : {}),
      confidence: globalMapping.confidence,
      evidenceId: globalMapping.evidence_id,
      createdBy: userId,
      createdAt: proposedAt,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "api_intelligence.global_mapping_proposed",
      targetType: "api_tenant_mapping",
      targetId: mappingId,
      metadata: {
        globalMappingId: globalMapping.id,
        sourceEntity: globalMapping.source_entity,
        canonicalEntity: globalMapping.canonical_entity,
        automaticApproval: false,
      },
    });
    return {
      mappingId,
      globalMappingId: globalMapping.id,
      status: "pending" as const,
    };
  });
}
