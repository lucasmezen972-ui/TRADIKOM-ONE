import { createHash } from "node:crypto";
import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso, safeJson } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import {
  hasApprovedApiProductClaim,
  listApiOperations,
} from "@/modules/api-intelligence/repository";
import { listApprovedTenantMappings } from "@/modules/api-intelligence/ontology";
import { connectorManifestSchema } from "@/modules/connector-copilot";
import { assertTenantAccess } from "@/modules/tenants";
import { UniversalConnectorError } from "@/modules/universal-connectors/errors";
import {
  findCurrentConnectorInstallationPlan,
  findUniversalConnectorCandidate,
  getNextConnectorInstallationPlanVersion,
  insertConnectorInstallationPlan,
  listConnectorInstallationPlans,
  listUniversalConnectorCandidates,
  supersedeConnectorInstallationPlan,
  type ConnectorInstallationPlanRow,
  type UniversalConnectorCandidateRow,
} from "@/modules/universal-connectors/repository";
import {
  prepareConnectorInstallationPlanSchema,
  type PrepareConnectorInstallationPlanInput,
} from "@/modules/universal-connectors/schemas";

const connectorPlannerRoles = ["owner", "administrator", "manager"] as const;

export async function getUniversalConnectorWorkspace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  const role = await assertTenantAccess(db, userId, tenantId);
  const [candidateRows, planRows] = await Promise.all([
    listUniversalConnectorCandidates(db, tenantId),
    listConnectorInstallationPlans(db, tenantId),
  ]);
  const candidates = await Promise.all(
    candidateRows.map((row) => assessCandidate(db, tenantId, row)),
  );
  return {
    canManage: connectorPlannerRoles.some((allowed) => allowed === role),
    candidates,
    plans: planRows.map(mapPlan),
  };
}

export async function prepareConnectorInstallationPlan(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: PrepareConnectorInstallationPlanInput,
) {
  const parsed = prepareConnectorInstallationPlanSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...connectorPlannerRoles,
    ]);
    const candidateRow = await findUniversalConnectorCandidate(
      transaction,
      tenantId,
      parsed.storeEntryId,
    );
    if (!candidateRow) {
      throw new UniversalConnectorError(
        "connector_candidate_not_found",
        "Ce connecteur n'est pas disponible pour cette organisation.",
      );
    }
    const candidate = await assessCandidate(transaction, tenantId, candidateRow);
    if (!candidate.eligible) {
      throw new UniversalConnectorError(
        "connector_evidence_incomplete",
        "Les preuves et tests approuvés sont insuffisants pour préparer ce plan.",
      );
    }
    const current = await findCurrentConnectorInstallationPlan(
      transaction,
      tenantId,
      candidate.storeEntryId,
    );
    if (current?.fingerprint === candidate.fingerprint) {
      return {
        planId: current.id,
        version: Number(current.version),
        created: false,
        enabled: false as const,
      };
    }
    const now = nowIso();
    if (current) {
      const superseded = await supersedeConnectorInstallationPlan(
        transaction,
        tenantId,
        current.id,
        now,
      );
      if (!superseded) {
        throw new UniversalConnectorError(
          "connector_plan_conflict",
          "Le plan a déjà été modifié.",
        );
      }
    }
    const version = await getNextConnectorInstallationPlanVersion(
      transaction,
      tenantId,
      candidate.storeEntryId,
    );
    const planId = id("connector_plan");
    await insertConnectorInstallationPlan(transaction, {
      id: planId,
      tenantId,
      storeEntryId: candidate.storeEntryId,
      proposalId: candidate.proposalId,
      fingerprint: candidate.fingerprint,
      tenantIndustry: candidate.tenantIndustry,
      industryMatch: candidate.industryMatch,
      capabilities: candidate.capabilities,
      evidence: candidate.evidence,
      blockers: [],
      version,
      supersedesId: current?.id,
      createdBy: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "universal_connector.installation_plan_prepared",
      targetType: "connector_installation_plan",
      targetId: planId,
      metadata: {
        proposalId: candidate.proposalId,
        version,
        capabilityCount: candidate.capabilities.length,
        mappingCount: candidate.evidence.mappingCount,
        installationMode: "sandbox_only",
        connectorEnabled: false,
        credentialsStored: false,
        externalWriteTriggered: false,
      },
    });
    return { planId, version, created: true, enabled: false as const };
  });
}

async function assessCandidate(
  db: DbClient,
  tenantId: string,
  row: UniversalConnectorCandidateRow,
) {
  const [productClaimApproved, mappings, operations] = await Promise.all([
    hasApprovedApiProductClaim(db, row.api_product_id),
    listApprovedTenantMappings(db, tenantId, row.api_product_id),
    listApiOperations(db, row.api_product_id),
  ]);
  const parsedManifest = connectorManifestSchema.safeParse(
    safeJson<unknown>(row.manifest, null),
  );
  const blockers: string[] = [];
  if (row.verification_status !== "approved_for_sandbox") {
    blockers.push("Validation sandbox absente.");
  }
  if (row.installation_status !== "not_installed") {
    blockers.push("État d'installation incompatible.");
  }
  if (row.proposal_status !== "approved_for_sandbox") {
    blockers.push("Proposition non approuvée pour le sandbox.");
  }
  if (Boolean(row.proposal_enabled)) {
    blockers.push("Une proposition active ne peut pas être planifiée ici.");
  }
  if (row.contract_status !== "passed" || !row.contract_run_id) {
    blockers.push("Tests de contrat mock non validés.");
  }
  if (!productClaimApproved) {
    blockers.push("Métadonnées API non approuvées.");
  }
  if (mappings.length === 0) {
    blockers.push("Aucune correspondance métier approuvée.");
  }
  if (operations.length === 0) {
    blockers.push("Aucune opération API approuvée.");
  }
  if (!parsedManifest.success) {
    blockers.push("Manifest de connecteur invalide.");
  }
  const manifest = parsedManifest.success ? parsedManifest.data : null;
  if (manifest && !manifestMatchesOperations(manifest.capabilities, operations)) {
    blockers.push("Les capacités ne correspondent plus aux preuves API approuvées.");
  }
  const industries = safeJson<string[]>(row.industries, []);
  const industryMatch = determineIndustryMatch(row.tenant_industry, industries);
  const capabilities = manifest
    ? manifest.capabilities.map((capability) => ({
        key: capability.operationKey,
        direction: capability.direction,
        method: capability.method.toUpperCase(),
        approvalRequired: capability.direction === "write",
      }))
    : [];
  const evidence = {
    apiProductId: row.api_product_id,
    apiVersion: row.api_version,
    apiLastVerifiedAt: row.api_last_verified_at,
    productClaimApproved,
    approvedOperationCount: operations.length,
    mappingCount: mappings.length,
    contractRunId: row.contract_run_id,
    contractStatus: row.contract_status,
    contractTestedAt: row.contract_created_at,
    generatedFromApiIntelligence: true,
    contractEnvironment: "mock",
  };
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        storeEntryId: row.store_entry_id,
        proposalId: row.proposal_id,
        connectorVersion: row.connector_version,
        tenantIndustry: row.tenant_industry,
        industries: [...industries].sort(),
        capabilities,
        mappingIds: mappings.map((mapping) => mapping.id).sort(),
        operationIds: operations.map((operation) => operation.id).sort(),
        contractRunId: row.contract_run_id,
        apiLastVerifiedAt: row.api_last_verified_at,
      }),
    )
    .digest("hex");
  return {
    storeEntryId: row.store_entry_id,
    proposalId: row.proposal_id,
    connectorName: row.connector_name,
    connectorVersion: row.connector_version,
    softwareName: row.software_name,
    vendor: row.vendor,
    tenantIndustry: row.tenant_industry,
    supportedIndustries: industries,
    industryMatch,
    capabilities,
    canonicalEntities: [
      ...new Set(mappings.map((mapping) => mapping.canonical_entity)),
    ],
    evidence,
    blockers,
    eligible: blockers.length === 0,
    fingerprint,
    enabled: false as const,
    installationMode: "sandbox_only" as const,
  };
}

function mapPlan(row: ConnectorInstallationPlanRow) {
  return {
    id: row.id,
    storeEntryId: row.store_entry_id,
    proposalId: row.connector_proposal_id,
    connectorName: row.connector_name,
    softwareName: row.software_name,
    status: row.record_status,
    enabled: false as const,
    installationMode: row.installation_mode,
    tenantIndustry: row.tenant_industry,
    industryMatch: row.industry_match,
    capabilities: safeJson<Array<Record<string, unknown>>>(
      row.capabilities_snapshot,
      [],
    ),
    evidence: safeJson<Record<string, unknown>>(row.evidence_summary, {}),
    blockers: safeJson<string[]>(row.blockers, []),
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function determineIndustryMatch(tenantIndustry: string, industries: string[]) {
  const tenantTokens = meaningfulTokens(tenantIndustry);
  const documentedTokens = new Set(industries.flatMap(meaningfulTokens));
  return tenantTokens.some((token) => documentedTokens.has(token))
    ? "aligned" as const
    : "not_documented" as const;
}

function meaningfulTokens(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
}

function manifestMatchesOperations(
  capabilities: Array<{
    operationKey: string;
    method: string;
    path: string;
    direction: "read" | "write";
  }>,
  operations: Array<{
    operationKey: string;
    method: string;
    path: string;
    capability: "read" | "write";
  }>,
) {
  if (capabilities.length !== operations.length) return false;
  const approved = new Set(
    operations.map(
      (operation) =>
        `${operation.operationKey}:${operation.method.toLowerCase()}:${operation.path}:${operation.capability}`,
    ),
  );
  return capabilities.every((capability) =>
    approved.has(
      `${capability.operationKey}:${capability.method.toLowerCase()}:${capability.path}:${capability.direction}`,
    ),
  );
}
