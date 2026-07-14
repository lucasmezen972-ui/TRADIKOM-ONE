import type { DbClient } from "@/lib/db";
import { id, nowIso, safeJson } from "@/lib/security";
import { withTenantDbTransaction } from "@/db/tenant-context";
import { recordAuditLog } from "@/modules/audit";
import {
  hasApprovedApiProductClaim,
  listApiOperations,
} from "@/modules/api-intelligence/repository";
import { listApprovedTenantMappings } from "@/modules/api-intelligence/ontology";
import { assertTenantAccess } from "@/modules/tenants";
import { assertPlatformAdmin } from "@/modules/platform-admin";
import { ConnectorCopilotError } from "@/modules/connector-copilot/errors";
import {
  decideApprovalRequest,
  findApprovalRequest,
  findConnectorProposal,
  findLatestContractRun,
  insertApprovalRequest,
  insertConnectorProposal,
  insertContractRun,
  listConnectStoreEntries,
  updateConnectorProposalStatus,
  upsertConnectStoreEntry,
} from "@/modules/connector-copilot/repository";
import {
  connectorAuthenticationTypeSchema,
  connectorManifestSchema,
  connectorProposalInputSchema,
  type ConnectorManifest,
} from "@/modules/connector-copilot/schemas";
import {
  findApiProductById,
  findSoftwareById,
} from "@/modules/software-directory";

export type MockContractExecutor = (
  capability: ConnectorManifest["capabilities"][number],
) => Promise<{ status: number; body: unknown }>;

export async function generateConnectorProposal(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { compatibilityCheckId: string; name: string },
) {
  const parsed = connectorProposalInputSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const compatibility = await findCompatibilityCheck(
      transaction,
      tenantId,
      parsed.compatibilityCheckId,
    );
    if (!compatibility) {
      throw new ConnectorCopilotError(
        "compatibility_not_found",
        "Analyse de compatibilite introuvable.",
      );
    }
    if (compatibility.outcome !== "custom_connector_possible") {
      throw new ConnectorCopilotError(
        "compatibility_not_ready",
        "Les preuves approuvees sont insuffisantes pour generer une proposition.",
      );
    }
    const apiProduct = await findApiProductById(
      transaction,
      compatibility.api_product_id,
    );
    const software = await findSoftwareById(
      transaction,
      compatibility.software_id,
    );
    if (!apiProduct || !software) {
      throw new ConnectorCopilotError(
        "compatibility_not_found",
        "Contexte API indisponible.",
      );
    }
    const operations = await listApiOperations(transaction, apiProduct.id);
    if (!(await hasApprovedApiProductClaim(transaction, apiProduct.id))) {
      throw new ConnectorCopilotError(
        "compatibility_not_ready",
        "Les metadonnees API doivent etre approuvees avant generation.",
      );
    }
    const mappings = await listApprovedTenantMappings(
      transaction,
      tenantId,
      apiProduct.id,
    );
    if (operations.length === 0 || mappings.length === 0) {
      throw new ConnectorCopilotError(
        "compatibility_not_ready",
        "Les operations et correspondances doivent conserver des preuves approuvees.",
      );
    }
    const authentication = connectorAuthenticationTypeSchema.safeParse(
      apiProduct.authentication_type,
    );
    if (!authentication.success) {
      throw new ConnectorCopilotError(
        "unsupported_authentication",
        "Le mode d'authentification API n'est pas pris en charge.",
      );
    }
    const supportedMethods = [
      "get",
      "post",
      "put",
      "patch",
      "delete",
      "head",
      "options",
    ] as const;
    const normalizedOperations = operations.map((operation) => ({
      ...operation,
      method: operation.method.toLowerCase(),
    }));
    if (
      normalizedOperations.some(
        (operation) =>
          !supportedMethods.some((method) => method === operation.method) ||
          !operation.path.startsWith("/"),
      )
    ) {
      throw new ConnectorCopilotError(
        "unsupported_operation",
        "Une operation API approuvee utilise un format non pris en charge.",
      );
    }
    const manifest = connectorManifestSchema.parse({
      manifestVersion: "1",
      connectorKey: slug(`${software.canonical_name}_${apiProduct.version}`),
      name: parsed.name,
      version: "0.1.0",
      enabled: false,
      apiProductId: apiProduct.id,
      authentication: { type: authentication.data },
      capabilities: normalizedOperations.map((operation) => ({
        operationKey: operation.operationKey,
        method: operation.method,
        path: operation.path,
        direction: operation.capability,
        timeoutMs: 10_000,
        idempotencyRequired: operation.capability === "write",
      })),
      mappings: mappings.map((mapping) => ({
        sourceEntity: mapping.source_entity,
        canonicalEntity: mapping.canonical_entity,
      })),
      pagination: { strategy: "none" },
      retry: { maxAttempts: 3, backoff: "exponential" },
      rateLimit: { strategy: "respect_headers" },
      webhooks: { supported: Boolean(apiProduct.webhook_support) },
      fixtureVersion: "1",
    });
    const proposalId = id("proposal");
    const createdAt = nowIso();
    await insertConnectorProposal(transaction, {
      id: proposalId,
      tenantId,
      softwareId: software.id,
      apiProductId: apiProduct.id,
      name: parsed.name,
      manifest,
      unresolvedQuestions: [
        "Les identifiants sandbox doivent etre fournis par un administrateur.",
      ],
      riskAssessment: {
        level: manifest.capabilities.some((item) => item.direction === "write")
          ? "medium"
          : "low",
        liveWritesAllowed: false,
        generatedFromApprovedEvidence: true,
      },
      createdBy: userId,
      createdAt,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "connector_copilot.proposal_generated",
      targetType: "connector_proposal",
      targetId: proposalId,
      metadata: { enabled: false, apiProductId: apiProduct.id },
    });
    return { proposalId, status: "static_checks_passed" as const, manifest };
  });
}

export async function runMockContractTests(
  db: DbClient,
  userId: string,
  tenantId: string,
  proposalId: string,
  options: { executor?: MockContractExecutor } = {},
) {
  await assertPlatformAdmin(db, userId, tenantId);
  const proposal = await findConnectorProposal(db, tenantId, proposalId);
  if (!proposal) {
    throw new ConnectorCopilotError(
      "proposal_not_found",
      "Proposition de connecteur introuvable.",
    );
  }
  const manifest = connectorManifestSchema.parse(
    safeJson<unknown>(proposal.manifest, null),
  );
  const executor = options.executor ?? defaultMockExecutor;
  const results: Array<{
    operationKey: string;
    status: "passed" | "failed";
    responseStatus?: number;
  }> = [];
  for (const capability of manifest.capabilities) {
    try {
      const response = await executor(capability);
      results.push({
        operationKey: capability.operationKey,
        status: response.status >= 200 && response.status < 300 ? "passed" : "failed",
        responseStatus: response.status,
      });
    } catch {
      results.push({ operationKey: capability.operationKey, status: "failed" });
    }
  }
  const status =
    results.length > 0 && results.every((result) => result.status === "passed")
      ? "passed" as const
      : "failed" as const;

  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const runId = id("contract");
    const createdAt = nowIso();
    await insertContractRun(transaction, {
      id: runId,
      tenantId,
      proposalId,
      connectorVersion: proposal.version,
      apiVersion: "imported",
      status,
      results,
      safeLogs: results.map(
        (result) => `${result.operationKey}: ${result.status}`,
      ),
      createdAt,
    });
    if (status === "passed") {
      await updateConnectorProposalStatus(transaction, {
        tenantId,
        proposalId,
        status: "contract_tests_passed",
        updatedAt: createdAt,
      });
    }
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "connector_copilot.contract_tests_completed",
      targetType: "connector_contract_run",
      targetId: runId,
      metadata: { proposalId, status, environment: "mock" },
    });
    return { runId, status, results };
  });
}

export async function submitConnectorForSandboxApproval(
  db: DbClient,
  userId: string,
  tenantId: string,
  proposalId: string,
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const proposal = await findConnectorProposal(transaction, tenantId, proposalId);
    if (!proposal) {
      throw new ConnectorCopilotError(
        "proposal_not_found",
        "Proposition de connecteur introuvable.",
      );
    }
    const latestRun = await findLatestContractRun(transaction, tenantId, proposalId);
    if (latestRun?.status !== "passed") {
      throw new ConnectorCopilotError(
        "contract_test_required",
        "Les tests de contrat mock doivent reussir avant soumission.",
      );
    }
    const approvalId = id("approval");
    const createdAt = nowIso();
    await insertApprovalRequest(transaction, {
      id: approvalId,
      tenantId,
      proposalId,
      submittedBy: userId,
      createdAt,
    });
    await updateConnectorProposalStatus(transaction, {
      tenantId,
      proposalId,
      status: "security_review_required",
      updatedAt: createdAt,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "connector_copilot.sandbox_approval_requested",
      targetType: "connector_approval_request",
      targetId: approvalId,
      metadata: { proposalId, scope: "sandbox" },
    });
    return { approvalId, status: "pending" as const };
  });
}

export async function decideConnectorSandboxApproval(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: {
    approvalId: string;
    decision: "approved" | "rejected";
    reason: string;
  },
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const approval = await findApprovalRequest(
      transaction,
      tenantId,
      input.approvalId,
    );
    if (!approval) {
      throw new ConnectorCopilotError(
        "approval_not_found",
        "Demande d'approbation introuvable.",
      );
    }
    if (approval.status !== "pending" || approval.requested_scope !== "sandbox") {
      throw new ConnectorCopilotError(
        "approval_state_invalid",
        "Demande d'approbation non modifiable.",
      );
    }
    const decidedAt = nowIso();
    await decideApprovalRequest(transaction, {
      tenantId,
      approvalId: input.approvalId,
      status: input.decision,
      decidedBy: userId,
      reason: input.reason,
      decidedAt,
    });
    await updateConnectorProposalStatus(transaction, {
      tenantId,
      proposalId: approval.connector_proposal_id,
      status:
        input.decision === "approved" ? "approved_for_sandbox" : "blocked",
      updatedAt: decidedAt,
    });
    if (input.decision === "approved") {
      const latestRun = await findLatestContractRun(
        transaction,
        tenantId,
        approval.connector_proposal_id,
      );
      await upsertConnectStoreEntry(transaction, {
        id: id("store"),
        tenantId,
        proposalId: approval.connector_proposal_id,
        lastTestedAt: latestRun?.created_at ?? decidedAt,
        knownLimitations: [
          "Approuve uniquement pour le sandbox.",
          "Installation et ecritures reelles desactivees.",
        ],
        createdAt: decidedAt,
      });
    }
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: `connector_copilot.sandbox_${input.decision}`,
      targetType: "connector_approval_request",
      targetId: input.approvalId,
      metadata: {
        proposalId: approval.connector_proposal_id,
        connectorEnabled: false,
      },
    });
    return {
      approvalId: input.approvalId,
      status: input.decision,
      connectorEnabled: false as const,
    };
  });
}

export async function getPrivateConnectStore(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  return listConnectStoreEntries(db, tenantId);
}

async function findCompatibilityCheck(
  db: DbClient,
  tenantId: string,
  checkId: string,
) {
  const result = await db.query<{
    id: string;
    software_id: string;
    api_product_id: string;
    outcome: string;
  }>(
    "select id, software_id, api_product_id, outcome from api_compatibility_checks where tenant_id = $1 and id = $2",
    [tenantId, checkId],
  );
  return result.rows[0] ?? null;
}

async function defaultMockExecutor() {
  return { status: 200, body: { fixture: true } };
}

function slug(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return normalized.replace(/^_+|_+$/g, "").slice(0, 80) || "connector";
}
