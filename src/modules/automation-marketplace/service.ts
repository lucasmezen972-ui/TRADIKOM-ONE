import { createHash } from "node:crypto";
import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso, safeJson } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { AutomationMarketplaceError } from "@/modules/automation-marketplace/errors";
import {
  findAutomationMarketplaceSource,
  findAutomationPackagePreview,
  findCurrentAutomationPackage,
  findCurrentAutomationPackageByKey,
  getNextAutomationPackageVersion,
  insertAutomationPackage,
  insertAutomationPackagePreview,
  listAutomationMarketplaceSources,
  listAutomationPackagePreviews,
  listCurrentAutomationPackages,
  supersedeAutomationPackage,
  type AutomationMarketplacePackageRow,
} from "@/modules/automation-marketplace/repository";
import {
  createAutomationPackageSchema,
  previewAutomationPackageSchema,
  type CreateAutomationPackageInput,
  type PreviewAutomationPackageInput,
} from "@/modules/automation-marketplace/schemas";
import { assertTenantAccess } from "@/modules/tenants";
import {
  workflowDefinitionSchema,
  type WorkflowDefinition,
} from "@/modules/workflows/types";

const managerRoles = ["owner", "administrator", "manager"] as const;

export async function getAutomationMarketplace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  const role = await assertTenantAccess(db, userId, tenantId);
  const [sources, packages, previews] = await Promise.all([
    listAutomationMarketplaceSources(db, tenantId),
    listCurrentAutomationPackages(db, tenantId),
    listAutomationPackagePreviews(db, tenantId),
  ]);
  const packagesByListing = new Map(
    packages.map((item) => [item.listing_id, item]),
  );
  const previewByPackage = new Map(
    previews.map((item) => [
      `${item.package_id}:${Number(item.package_version)}`,
      item,
    ]),
  );
  return {
    canManage: managerRoles.some((allowed) => allowed === role),
    sources: sources.map((source) => ({
      listingId: source.listing_id,
      title: source.name,
      trigger: source.trigger_name,
      listingVersion: Number(source.listing_version),
      packaged: packagesByListing.has(source.listing_id),
    })),
    packages: packages.map((row) => {
      const item = mapPackage(row);
      const preview = previewByPackage.get(`${row.id}:${Number(row.version)}`);
      return {
        ...item,
        preview: preview
          ? {
              id: preview.id,
              status: preview.status,
              installationMode: preview.installation_mode,
              executionEnabled: Boolean(preview.execution_enabled),
              steps: safeJson<string[]>(preview.preview_steps, []),
              permissionReview: safeJson<Record<string, unknown>>(
                preview.permission_review,
                {},
              ),
              blockers: safeJson<string[]>(preview.blockers, []),
            }
          : null,
      };
    }),
  };
}

export async function createPrivateAutomationPackage(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: CreateAutomationPackageInput,
) {
  const parsed = createAutomationPackageSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...managerRoles]);
    const source = await findAutomationMarketplaceSource(
      transaction,
      tenantId,
      parsed.listingId,
    );
    if (!source) {
      throw new AutomationMarketplaceError(
        "automation_source_not_found",
        "Ce workflow privé n'est plus disponible.",
      );
    }
    const definition = workflowDefinitionSchema.safeParse(
      safeJson<unknown>(source.definition, null),
    );
    if (!definition.success) {
      throw new AutomationMarketplaceError(
        "automation_source_invalid",
        "La définition du workflow n'est pas exploitable.",
      );
    }
    const template = sanitizeWorkflowTemplate(definition.data);
    const requiredConfiguration = [
      ...new Set(
        definition.data.actions.flatMap((action) => Object.keys(action.input)),
      ),
    ].sort();
    const packageKey = `workflow:${source.workflow_key}`;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          listingId: source.listing_id,
          listingFingerprint: source.listing_fingerprint,
          template,
          requiredConfiguration,
        }),
      )
      .digest("hex");
    const current = await findCurrentAutomationPackageByKey(
      transaction,
      tenantId,
      packageKey,
    );
    if (current?.fingerprint === fingerprint) {
      return {
        packageId: current.id,
        version: Number(current.version),
        created: false,
      };
    }
    const now = nowIso();
    if (current) {
      const superseded = await supersedeAutomationPackage(
        transaction,
        tenantId,
        current.id,
        now,
      );
      if (!superseded) {
        throw new AutomationMarketplaceError(
          "automation_package_conflict",
          "Ce paquet a déjà été actualisé.",
        );
      }
    }
    const version = await getNextAutomationPackageVersion(
      transaction,
      tenantId,
      packageKey,
    );
    const packageId = id("automation_package");
    await insertAutomationPackage(transaction, {
      id: packageId,
      tenantId,
      listingId: source.listing_id,
      workflowId: source.workflow_id,
      packageKey,
      title: source.name,
      summary: `Modèle privé déclenché par ${source.trigger_name}.`,
      template,
      requiredConfiguration,
      approvalPolicy: definition.data.approvalPolicy,
      fingerprint,
      version,
      supersedesId: current?.id,
      createdBy: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "automation_marketplace.private_package_created",
      targetType: "automation_marketplace_package",
      targetId: packageId,
      metadata: {
        listingId: source.listing_id,
        version,
        actionCount: definition.data.actions.length,
        requiredConfigurationCount: requiredConfiguration.length,
        visibility: "tenant_private",
        inputValuesStored: false,
        executionEnabled: false,
        externalActionTriggered: false,
      },
    });
    return { packageId, version, created: true };
  });
}

export async function previewPrivateAutomationPackage(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: PreviewAutomationPackageInput,
) {
  const parsed = previewAutomationPackageSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...managerRoles]);
    const automationPackage = await findCurrentAutomationPackage(
      transaction,
      tenantId,
      parsed.packageId,
    );
    if (!automationPackage) {
      throw new AutomationMarketplaceError(
        "automation_package_not_found",
        "Ce paquet privé n'est plus disponible.",
      );
    }
    const version = Number(automationPackage.version);
    const current = await findAutomationPackagePreview(
      transaction,
      tenantId,
      automationPackage.id,
      version,
    );
    if (current) {
      return {
        previewId: current.id,
        created: false,
        executionEnabled: false as const,
      };
    }
    const previewId = id("automation_preview");
    const now = nowIso();
    await insertAutomationPackagePreview(transaction, {
      id: previewId,
      tenantId,
      packageId: automationPackage.id,
      packageVersion: version,
      packageFingerprint: automationPackage.fingerprint,
      steps: [
        "Examiner la structure et les permissions du modèle.",
        "Renseigner les paramètres requis sans reprendre les valeurs source.",
        "Soumettre toute future activation à une approbation distincte.",
      ],
      permissionReview: {
        approvalPolicy: automationPackage.approval_policy,
        humanApprovalRequired: true,
        sourceInputValuesCopied: false,
        executionAllowed: false,
        externalSendAllowed: false,
        publicSharingAllowed: false,
      },
      blockers: ["Import réel et exécution du workflow indisponibles."],
      createdBy: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "automation_marketplace.preview_created",
      targetType: "automation_marketplace_preview",
      targetId: previewId,
      metadata: {
        packageId: automationPackage.id,
        packageVersion: version,
        installationMode: "preview_only",
        executionEnabled: false,
        externalActionTriggered: false,
      },
    });
    return { previewId, created: true, executionEnabled: false as const };
  });
}

function sanitizeWorkflowTemplate(definition: WorkflowDefinition) {
  return {
    sourceVersion: definition.version,
    trigger: definition.trigger,
    active: false,
    conditionCount: definition.conditions.length,
    actions: definition.actions.map((action) => ({
      type: action.type,
      inputKeys: Object.keys(action.input).sort(),
      idempotencyConfigured: Boolean(action.idempotencyKey),
    })),
    retryPolicy: definition.retryPolicy,
    timeoutMs: definition.timeoutMs,
    approvalPolicy: definition.approvalPolicy,
    inputValuesIncluded: false,
  };
}

function mapPackage(row: AutomationMarketplacePackageRow) {
  return {
    id: row.id,
    listingId: row.listing_id,
    packageKey: row.package_key,
    title: row.title,
    summary: row.summary,
    template: safeJson<Record<string, unknown>>(row.template_snapshot, {}),
    requiredConfiguration: safeJson<string[]>(row.required_configuration, []),
    approvalPolicy: row.approval_policy,
    version: Number(row.version),
    visibility: row.visibility,
    executionEnabled: Boolean(row.execution_enabled),
  };
}
