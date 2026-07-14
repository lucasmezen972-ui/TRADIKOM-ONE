import { createHash } from "node:crypto";
import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso, safeJson } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { AppMarketplaceError } from "@/modules/app-marketplace/errors";
import {
  findCurrentMarketplaceListing,
  findCurrentMarketplaceListingByKey,
  findMarketplaceInstallationPreview,
  getNextMarketplaceListingVersion,
  insertMarketplaceInstallationPreview,
  insertMarketplaceListing,
  listCurrentMarketplaceListings,
  listMarketplaceInstallationPreviews,
  listMarketplaceSourceRows,
  supersedeMarketplaceListing,
  type MarketplaceListingRow,
  type MarketplaceSourceRow,
} from "@/modules/app-marketplace/repository";
import {
  previewMarketplaceInstallationSchema,
  type MarketplaceCategory,
  type PreviewMarketplaceInstallationInput,
} from "@/modules/app-marketplace/schemas";
import { assertTenantAccess } from "@/modules/tenants";
import { workflowDefinitionSchema } from "@/modules/workflows/types";

const marketplaceManagerRoles = ["owner", "administrator", "manager"] as const;

export async function getPrivateAppMarketplace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  const role = await assertTenantAccess(db, userId, tenantId);
  const [listingRows, previewRows] = await Promise.all([
    listCurrentMarketplaceListings(db, tenantId),
    listMarketplaceInstallationPreviews(db, tenantId),
  ]);
  const previewByListing = new Map(
    previewRows.map((preview) => [
      `${preview.listing_id}:${Number(preview.listing_version)}`,
      preview,
    ]),
  );
  return {
    canManage: marketplaceManagerRoles.some((allowed) => allowed === role),
    listings: listingRows.map((row) => {
      const listing = mapListing(row);
      const preview = previewByListing.get(`${row.id}:${Number(row.version)}`);
      return {
        ...listing,
        preview: preview
          ? {
              id: preview.id,
              status: preview.status,
              installationMode: preview.installation_mode,
              enabled: Boolean(preview.enabled),
              steps: safeJson<string[]>(preview.installation_steps, []),
              permissionReview: safeJson<Record<string, unknown>>(
                preview.permission_review,
                {},
              ),
              blockers: safeJson<string[]>(preview.blockers, []),
              createdAt: preview.created_at,
            }
          : null,
      };
    }),
  };
}

export async function refreshPrivateAppMarketplace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...marketplaceManagerRoles,
    ]);
    const sources = await listMarketplaceSourceRows(transaction, tenantId);
    let createdCount = 0;
    let unchangedCount = 0;
    const categories = new Set<MarketplaceCategory>();

    for (const source of sources) {
      const candidate = normalizeSource(source);
      categories.add(candidate.category);
      const current = await findCurrentMarketplaceListingByKey(
        transaction,
        tenantId,
        candidate.listingKey,
      );
      if (current?.fingerprint === candidate.fingerprint) {
        unchangedCount += 1;
        continue;
      }
      const now = nowIso();
      if (current) {
        const superseded = await supersedeMarketplaceListing(
          transaction,
          tenantId,
          current.id,
          now,
        );
        if (!superseded) {
          throw new AppMarketplaceError(
            "marketplace_listing_conflict",
            "Cette fiche a déjà été actualisée.",
          );
        }
      }
      const version = await getNextMarketplaceListingVersion(
        transaction,
        tenantId,
        candidate.listingKey,
      );
      await insertMarketplaceListing(transaction, {
        id: id("marketplace_listing"),
        tenantId,
        ...candidate,
        version,
        supersedesId: current?.id,
        createdBy: userId,
        now,
      });
      createdCount += 1;
    }

    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "app_marketplace.private_catalog_refreshed",
      targetType: "tenant",
      targetId: tenantId,
      metadata: {
        sourceCount: sources.length,
        createdCount,
        unchangedCount,
        categories: [...categories].sort(),
        visibility: "private",
        installationEnabled: false,
        externalExecutionTriggered: false,
      },
    });
    return { sourceCount: sources.length, createdCount, unchangedCount };
  });
}

export async function previewPrivateMarketplaceInstallation(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: PreviewMarketplaceInstallationInput,
) {
  const parsed = previewMarketplaceInstallationSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...marketplaceManagerRoles,
    ]);
    const listing = await findCurrentMarketplaceListing(
      transaction,
      tenantId,
      parsed.listingId,
    );
    if (!listing) {
      throw new AppMarketplaceError(
        "marketplace_listing_not_found",
        "Cette fiche privée n'est plus disponible.",
      );
    }
    const listingVersion = Number(listing.version);
    const current = await findMarketplaceInstallationPreview(
      transaction,
      tenantId,
      listing.id,
      listingVersion,
    );
    if (current) {
      return { previewId: current.id, created: false, enabled: false as const };
    }
    const previewId = id("marketplace_preview");
    const now = nowIso();
    const installationSteps = [
      "Vérifier la provenance et la version de la fiche.",
      "Examiner les capacités, permissions et limites.",
      "Soumettre toute future installation à une approbation distincte.",
    ];
    const permissionReview = {
      sourceKind: listing.source_kind,
      humanApprovalRequired: true,
      externalExecutionAllowed: false,
      productionWritesAllowed: false,
      connectorActivationAllowed: false,
      publicSharingAllowed: false,
      paymentAllowed: false,
    };
    const blockers = [
      "Installation réelle, activation et exécution externes indisponibles.",
    ];
    await insertMarketplaceInstallationPreview(transaction, {
      id: previewId,
      tenantId,
      listingId: listing.id,
      listingVersion,
      listingFingerprint: listing.fingerprint,
      installationSteps,
      permissionReview,
      blockers,
      createdBy: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "app_marketplace.installation_preview_created",
      targetType: "marketplace_installation_preview",
      targetId: previewId,
      metadata: {
        listingId: listing.id,
        listingVersion,
        category: listing.category,
        installationMode: "preview_only",
        installationEnabled: false,
        credentialsStored: false,
        externalExecutionTriggered: false,
      },
    });
    return { previewId, created: true, enabled: false as const };
  });
}

function normalizeSource(row: MarketplaceSourceRow) {
  const category = categoryForSource(row.source_kind);
  let capabilities: unknown[] = [];
  let permissions: unknown[] = [];
  let provenance = safeJson<Record<string, unknown>>(row.provenance, {});

  if (row.source_kind === "connector_plan") {
    capabilities = safeJson<unknown[]>(row.capabilities, []);
    permissions = [
      { capability: "sandbox_preview", access: "preview_only" },
      { capability: "connector_activation", access: "prohibited" },
    ];
  } else if (row.source_kind === "workflow") {
    const definition = workflowDefinitionSchema.safeParse(
      safeJson<unknown>(row.capabilities, null),
    );
    capabilities = definition.success
      ? definition.data.actions.map((action) => ({ type: action.type }))
      : [];
    permissions = [
      { approvalPolicy: row.permissions },
      { capability: "workflow_execution", access: "prohibited_from_catalog" },
    ];
    provenance = {
      ...provenance,
      definitionVersion: definition.success ? definition.data.version : null,
    };
  } else {
    capabilities = safeJson<unknown[]>(row.capabilities, []);
    permissions = safeJson<unknown[]>(row.permissions, []);
  }

  const sourceVersion = Number(row.source_version);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        listingKey: row.source_key,
        sourceKind: row.source_kind,
        sourceId: row.source_id,
        sourceVersion,
        sourceStatus: row.source_status,
        title: row.title,
        summary: row.summary,
        capabilities,
        permissions,
        provenance,
      }),
    )
    .digest("hex");
  return {
    listingKey: row.source_key,
    category,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    title: row.title,
    summary: row.summary,
    fingerprint,
    capabilities,
    permissions,
    provenance: {
      ...provenance,
      sourceId: row.source_id,
      sourceVersion,
      sourceStatus: row.source_status,
      capturedAt: row.updated_at,
    },
  };
}

function categoryForSource(
  sourceKind: MarketplaceSourceRow["source_kind"],
): MarketplaceCategory {
  if (sourceKind === "connector_plan") return "connector";
  if (sourceKind === "workflow") return "workflow";
  return "ai_employee";
}

function mapListing(row: MarketplaceListingRow) {
  return {
    id: row.id,
    listingKey: row.listing_key,
    category: row.category,
    sourceKind: row.source_kind,
    title: row.title,
    summary: row.summary,
    version: Number(row.version),
    visibility: row.visibility,
    capabilities: safeJson<unknown[]>(row.capabilities_snapshot, []),
    permissions: safeJson<unknown[]>(row.permissions_snapshot, []),
    provenance: safeJson<Record<string, unknown>>(row.provenance_snapshot, {}),
    updatedAt: row.updated_at,
  };
}
