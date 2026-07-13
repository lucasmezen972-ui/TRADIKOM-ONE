import { z } from "zod";
import type { DbClient } from "@/lib/db";
import { id, nowIso, safeJson, toJson } from "@/lib/security";
import { withTenantDbTransaction } from "@/db/tenant-context";
import {
  hasApprovedApiProductClaim,
  listApiOperations,
} from "@/modules/api-intelligence/repository";
import { listApprovedTenantMappings } from "@/modules/api-intelligence/ontology";
import { assertTenantAccess } from "@/modules/tenants";
import {
  findApiProductById,
  findSoftwareById,
  SoftwareDirectoryError,
} from "@/modules/software-directory";

export const compatibilityOutcomeSchema = z.enum([
  "ready_now",
  "configuration_required",
  "partner_access_required",
  "import_only",
  "custom_connector_possible",
  "documentation_required",
  "unsupported",
  "prohibited",
]);

export const compatibilityInputSchema = z.object({
  softwareId: z.string().min(1),
  apiProductId: z.string().min(1),
  tenantIndustry: z.string().trim().min(1).max(160),
  desiredAutomation: z.string().trim().min(3).max(500),
});

export async function runCompatibilityCheck(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: z.infer<typeof compatibilityInputSchema>,
) {
  const parsed = compatibilityInputSchema.parse(input);
  await assertTenantAccess(db, userId, tenantId);
  const software = await findSoftwareById(db, parsed.softwareId);
  const apiProduct = await findApiProductById(db, parsed.apiProductId);
  if (!software || !apiProduct || apiProduct.software_id !== parsed.softwareId) {
    throw new SoftwareDirectoryError(
      "api_product_not_found",
      "Produit API introuvable.",
    );
  }
  const operations = await listApiOperations(db, parsed.apiProductId);
  const productClaimApproved = await hasApprovedApiProductClaim(
    db,
    parsed.apiProductId,
  );
  const mappings = await listApprovedTenantMappings(
    db,
    tenantId,
    parsed.apiProductId,
  );
  const connector = await findApprovedConnector(db, tenantId, parsed.apiProductId);
  const evidence = await listProductEvidence(db, parsed.apiProductId);
  const outcome = determineOutcome({
    accessLevel: apiProduct.access_level,
    partnerRequired: Boolean(apiProduct.partner_access_requirement),
    operationCount: operations.length,
    mappingCount: mappings.length,
    productClaimApproved,
    productionApproved: connector?.status === "approved",
  });
  const result = {
    matchedSoftware: software.canonical_name,
    apiAccessStatus: apiProduct.access_level,
    evidence,
    confidence: apiProduct.confidence_score,
    supportedBusinessEntities: [
      ...new Set(mappings.map((mapping) => mapping.canonical_entity)),
    ],
    readableOperations: operations.filter((item) => item.capability === "read"),
    writableOperations: operations.filter((item) => item.capability === "write"),
    webhookSupport: Boolean(apiProduct.webhook_support),
    authentication: apiProduct.authentication_type,
    sandboxAvailability: Boolean(apiProduct.sandbox_support),
    partnerRequirement: Boolean(apiProduct.partner_access_requirement),
    existingConnectorStatus: connector?.status ?? "none",
    connectorDifficulty:
      operations.length <= 5 ? "low" : operations.length <= 25 ? "medium" : "high",
    blockers: buildBlockers(outcome, operations.length, mappings.length),
    lastVerificationDate: apiProduct.last_verified_at,
    outcome,
  };

  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId);
    const checkId = id("compatibility");
    await transaction.query(
      `insert into api_compatibility_checks (
         id, tenant_id, software_id, api_product_id, desired_automation,
         outcome, result, created_by, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        checkId,
        tenantId,
        parsed.softwareId,
        parsed.apiProductId,
        parsed.desiredAutomation,
        outcome,
        toJson(result),
        userId,
        nowIso(),
      ],
    );
    return { checkId, ...result };
  });
}

export async function getLatestCompatibilityCheck(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const result = await db.query<{ id: string; result: string }>(
    `select id, result from api_compatibility_checks
     where tenant_id = $1 order by created_at desc limit 1`,
    [tenantId],
  );
  const row = result.rows[0];
  return row ? { id: row.id, ...safeJson<Record<string, unknown>>(row.result, {}) } : null;
}

function determineOutcome(input: {
  accessLevel: string;
  partnerRequired: boolean;
  operationCount: number;
  mappingCount: number;
  productClaimApproved: boolean;
  productionApproved: boolean;
}) {
  if (input.accessLevel === "private") return "prohibited" as const;
  if (input.partnerRequired) return "partner_access_required" as const;
  if (!input.productClaimApproved) return "documentation_required" as const;
  if (input.operationCount === 0) return "documentation_required" as const;
  if (input.mappingCount === 0) return "configuration_required" as const;
  if (input.productionApproved) return "ready_now" as const;
  return "custom_connector_possible" as const;
}

function buildBlockers(outcome: string, operations: number, mappings: number) {
  const blockers: string[] = [];
  if (operations === 0) blockers.push("Aucune operation technique importee.");
  if (mappings === 0) blockers.push("Aucune correspondance metier approuvee.");
  if (outcome === "documentation_required" && operations > 0) {
    blockers.push("Les metadonnees API doivent etre approuvees.");
  }
  if (outcome === "custom_connector_possible") {
    blockers.push("Connecteur non teste et non approuve pour la production.");
  }
  return blockers;
}

async function findApprovedConnector(
  db: DbClient,
  tenantId: string,
  apiProductId: string,
) {
  const result = await db.query<{ status: string }>(
    `select status from connector_proposals
     where tenant_id = $1 and api_product_id = $2
     order by updated_at desc limit 1`,
    [tenantId, apiProductId],
  );
  return result.rows[0] ?? null;
}

async function listProductEvidence(db: DbClient, apiProductId: string) {
  const result = await db.query<{
    source_url: string;
    content_hash: string;
    locator: string;
  }>(
    `select distinct api_sources.canonical_url as source_url,
            api_source_snapshots.content_hash,
            api_evidence.locator
     from api_evidence
     join api_source_snapshots on api_source_snapshots.id = api_evidence.source_snapshot_id
     join api_sources on api_sources.id = api_source_snapshots.source_id
     join api_claims on api_claims.id = api_evidence.claim_id
     where api_claims.approval_status = 'approved'
       and (
         (api_claims.subject_type = 'api_product'
          and api_claims.subject_id = $1)
         or exists (
           select 1 from api_schemas
           where api_schemas.id = api_claims.subject_id
             and api_schemas.api_product_id = $1
         )
         or exists (
           select 1 from api_operations
           where api_operations.id = api_claims.subject_id
             and api_operations.api_product_id = $1
         )
       )
     order by api_evidence.locator asc`,
    [apiProductId],
  );
  return result.rows.map((row) => ({
    sourceUrl: row.source_url,
    contentHash: row.content_hash,
    locator: row.locator,
  }));
}
