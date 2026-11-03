import type { DbClient } from "@/lib/db";
import { withTenantDbTransaction } from "@/db/tenant-context";
import { createWebsiteDraft } from "@/lib/generation";
import { id, nowIso, safeJson, toJson } from "@/lib/security";
import type { BusinessProfile, WebsiteSection } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import { getTenantById, assertTenantAccess, lockTenantForPublicationMutation } from "@/modules/tenants";
import { WebsiteError } from "@/modules/websites/errors";
import { AssetError } from "@/modules/assets/errors";
import { findTenantAssetForTenant } from "@/modules/assets/repository";
import {
  deleteWebsiteSections,
  findBusinessProfile,
  findPublicSiteBySlug,
  findSectionWebsite,
  findWebsite,
  findWebsiteId,
  findWebsiteSections,
  findWebsiteVersionSnapshot,
  insertWebsite,
  insertWebsiteForm,
  insertWebsitePage,
  insertWebsitePublication,
  insertWebsiteSection,
  insertWebsiteVersion,
  listSectionPositions,
  listWebsiteVersions,
  markWebsiteDraft,
  publishWebsiteVersion,
  updateSectionPosition,
  updateWebsiteFromDraft,
  updateWebsiteSectionContent,
  updateWebsiteVersionPointers,
} from "@/modules/websites/repository";
import {
  moveWebsiteSectionSchema,
  restoreWebsiteVersionSchema,
  websiteSectionUpdateSchema,
  type WebsiteSectionUpdateInput,
} from "@/modules/websites/schemas";

export { findWebsite as getWebsite };

export async function generateOrReplaceWebsite(
  db: DbClient,
  tenantId: string,
  profile: BusinessProfile,
) {
  const existingWebsiteId = await findWebsiteId(db, tenantId);
  const draft = createWebsiteDraft(tenantId, profile);

  if (existingWebsiteId) {
    await deleteWebsiteSections(db, tenantId, existingWebsiteId);
    await updateWebsiteFromDraft(db, {
      tenantId,
      websiteId: existingWebsiteId,
      website: draft.website,
      updatedAt: nowIso(),
    });

    for (const section of draft.sections) {
      await insertWebsiteSection(db, { ...section, websiteId: existingWebsiteId });
    }

    await snapshotWebsite(db, tenantId, existingWebsiteId, "deterministic_regeneration");
    return;
  }

  await insertWebsite(db, draft.website);
  await insertWebsitePage(db, {
    id: id("page"),
    tenantId,
    websiteId: draft.website.id,
    slug: "accueil",
    title: draft.website.name,
    seoMetadata: toJson({
      title: draft.website.name,
      description: profile.identity.description,
    }),
    createdAt: nowIso(),
  });
  await insertWebsiteForm(db, {
    id: id("form"),
    tenantId,
    websiteId: draft.website.id,
    name: "Formulaire contact site",
    createdAt: nowIso(),
  });

  for (const section of draft.sections) {
    await insertWebsiteSection(db, section);
  }

  await snapshotWebsite(db, tenantId, draft.website.id, "deterministic_generation");
}

export async function getWebsiteWorkspace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const website = await findWebsite(db, tenantId);
  const profile = await findBusinessProfile(db, tenantId);
  const sections = website ? await findWebsiteSections(db, tenantId, website.id) : [];
  const versions = website ? await listWebsiteVersions(db, tenantId, website.id) : [];

  return { profile, website, sections, versions };
}

export async function updateWebsiteSection(
  db: DbClient,
  userId: string,
  tenantId: string,
  sectionId: string,
  input: WebsiteSectionUpdateInput,
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      "owner",
      "administrator",
      "manager",
      "collaborator",
    ]);
    await lockTenantForPublicationMutation(transaction, tenantId);
    const parsed = websiteSectionUpdateSchema.parse(input);
    const websiteId = await findSectionWebsite(transaction, tenantId, sectionId);
    if (!websiteId) {
      throw new WebsiteError("section_not_found", "Section introuvable.");
    }

    await assertSectionImageAsset(transaction, tenantId, parsed.imageUrl);
    await updateWebsiteSectionContent(transaction, {
      tenantId,
      sectionId,
      ...parsed,
    });
    await markWebsiteDraft(transaction, {
      tenantId,
      websiteId,
      updatedAt: nowIso(),
    });
    await snapshotWebsite(transaction, tenantId, websiteId, "manual_edit");
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "website.section_updated",
      targetType: "website_section",
      targetId: sectionId,
      metadata: { enabled: parsed.enabled },
    });
  });
}

export async function moveWebsiteSection(
  db: DbClient,
  userId: string,
  tenantId: string,
  sectionId: string,
  direction: "up" | "down",
) {
  await assertTenantAccess(db, userId, tenantId, [
    "owner",
    "administrator",
    "manager",
    "collaborator",
  ]);
  const parsed = moveWebsiteSectionSchema.parse({ direction });
  const sections = await listSectionPositions(db, tenantId);
  const index = sections.findIndex((section) => section.id === sectionId);
  const targetIndex = parsed.direction === "up" ? index - 1 : index + 1;
  const current = sections[index];
  const target = sections[targetIndex];

  if (!current || !target) {
    return;
  }

  await updateSectionPosition(db, tenantId, current.id, target.position);
  await updateSectionPosition(db, tenantId, target.id, current.position);
  await markWebsiteDraft(db, {
    tenantId,
    websiteId: current.website_id,
    updatedAt: nowIso(),
  });
  await snapshotWebsite(db, tenantId, current.website_id, "manual_reorder");
  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "website.section_reordered",
    targetType: "website_section",
    targetId: sectionId,
    metadata: { direction: parsed.direction },
  });
}

export async function publishWebsite(db: DbClient, userId: string, tenantId: string) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      "owner",
      "administrator",
      "manager",
    ]);
    await lockTenantForPublicationMutation(transaction, tenantId);
    const website = await findWebsite(transaction, tenantId);
    if (!website) {
      throw new WebsiteError("website_not_found", "Aucun site a publier.");
    }

    const sections = await findWebsiteSections(transaction, tenantId, website.id);
    for (const section of sections) await assertSectionImageAsset(transaction, tenantId, section.imageUrl);

    const versionId = await snapshotWebsite(
      transaction,
      tenantId,
      website.id,
      "publication",
      "published",
    );
    const tenant = await getTenantById(transaction, tenantId);
    const now = nowIso();
    const localUrl = `/sites/${tenant.slug}`;

    await publishWebsiteVersion(transaction, {
      tenantId,
      websiteId: website.id,
      versionId,
      publishedAt: now,
    });
    await insertWebsitePublication(transaction, {
      id: id("publication"),
      tenantId,
      websiteId: website.id,
      versionId,
      localUrl,
      publishedAt: now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "website.published",
      targetType: "website",
      targetId: website.id,
      metadata: { localUrl },
    });

    return localUrl;
  });
}

export async function restoreWebsiteVersion(
  db: DbClient,
  userId: string,
  tenantId: string,
  versionId: string,
) {
  const parsed = restoreWebsiteVersionSchema.parse({ versionId });
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      "owner",
      "administrator",
      "manager",
    ]);
    await lockTenantForPublicationMutation(transaction, tenantId);
    const version = await findWebsiteVersionSnapshot(
      transaction,
      tenantId,
      parsed.versionId,
    );
    if (!version) {
      throw new WebsiteError("version_not_found", "Version introuvable.");
    }

    const snapshot = safeJson<{ sections: WebsiteSection[] }>(version.snapshot, {
      sections: [],
    });
    for (const section of snapshot.sections) await assertSectionImageAsset(transaction, tenantId, section.imageUrl);
    await deleteWebsiteSections(transaction, tenantId, version.website_id);

    for (const section of snapshot.sections) {
      await insertWebsiteSection(transaction, {
        ...section,
        id: id("section"),
        tenantId,
        websiteId: version.website_id,
      });
    }

    await markWebsiteDraft(transaction, {
      tenantId,
      websiteId: version.website_id,
      updatedAt: nowIso(),
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "website.version_restored",
      targetType: "website_version",
      targetId: parsed.versionId,
      metadata: {},
    });
  });
}

export async function getPublishedSite(db: DbClient, slug: string) {
  const published = await findPublicSiteBySlug(db, slug);
  if (!published) return null;
  return {
    tenant: { id: published.tenant_id, slug: published.tenant_slug },
    website: published.website,
    sections: published.sections,
  };
}

async function assertSectionImageAsset(db: DbClient, tenantId: string, imageUrl?: string) {
  if (!imageUrl?.startsWith("/fichiers/")) return;
  const assetId = imageUrl.slice("/fichiers/".length);
  if (!assetId || !await findTenantAssetForTenant(db, tenantId, assetId)) {
    throw new AssetError("asset_not_found", "Cette image n’est plus disponible dans cette organisation.");
  }
}

async function snapshotWebsite(
  db: DbClient,
  tenantId: string,
  websiteId: string,
  source: string,
  versionType: "draft" | "published" = "draft",
) {
  const website = await findWebsite(db, tenantId);
  if (!website) {
    throw new WebsiteError("website_not_found", "Site introuvable.");
  }
  const sections = await findWebsiteSections(db, tenantId, websiteId);
  const versionId = id("version");
  await insertWebsiteVersion(db, {
    id: versionId,
    tenantId,
    websiteId,
    snapshot: toJson({ website, sections }),
    source,
    versionType,
    createdAt: nowIso(),
  });
  await updateWebsiteVersionPointers(db, {
    tenantId,
    websiteId,
    versionId,
    versionType,
  });
  return versionId;
}
