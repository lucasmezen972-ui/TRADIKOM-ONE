import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { withTenantDbTransaction } from "@/db/tenant-context";
import { recordAuditLog } from "@/modules/audit";
import { AnalyzerError } from "@/modules/api-intelligence/analyzer";
import { findSchemaEvidence } from "@/modules/api-intelligence/repository";
import {
  findTenantOntologyMapping,
  insertTenantOntologyMapping,
  setTenantMappingApproval,
} from "@/modules/api-intelligence/ontology/repository";
import {
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
