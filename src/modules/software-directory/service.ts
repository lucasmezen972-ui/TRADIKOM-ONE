import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { withTenantDbTransaction } from "@/db/tenant-context";
import { recordAuditLog } from "@/modules/audit";
import { assertPlatformAdmin } from "@/modules/platform-admin";
import { SoftwareDirectoryError } from "@/modules/software-directory/errors";
import {
  findApiProductById,
  findApprovedSoftwareDomain,
  findSoftwareById,
  findSoftwareDomainById,
  insertApiProduct,
  insertApiSource,
  insertSoftwareDirectoryEntry,
  insertSoftwareDomain,
  listSoftwareDirectory,
  setSoftwareDomainDecision,
} from "@/modules/software-directory/repository";
import {
  apiProductInputSchema,
  apiSourceInputSchema,
  softwareInputSchema,
  type ApiProductInput,
  type ApiSourceInput,
  type SoftwareInput,
} from "@/modules/software-directory/schemas";

export async function createSoftwareDirectoryEntry(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: SoftwareInput,
) {
  const parsed = softwareInputSchema.parse(input);
  const officialDomain = normalizeDomain(parsed.officialDomain);
  const website = normalizeHttpsUrl(parsed.officialWebsite);
  if (new URL(website).hostname !== officialDomain) {
    throw new SoftwareDirectoryError(
      "publisher_domain_mismatch",
      "Le site officiel doit correspondre au domaine declare.",
    );
  }

  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const softwareId = id("software");
    const domainId = id("domain");
    const createdAt = nowIso();
    await insertSoftwareDirectoryEntry(transaction, {
      ...parsed,
      officialDomain,
      officialWebsite: website,
      id: softwareId,
      createdBy: userId,
      createdAt,
    });
    await insertSoftwareDomain(transaction, {
      id: domainId,
      softwareId,
      domain: officialDomain,
      createdAt,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "api_intelligence.software_created",
      targetType: "software_directory_entry",
      targetId: softwareId,
      metadata: { domain: officialDomain, approvalStatus: "pending" },
    });
    return { softwareId, domainId, approvalStatus: "pending" as const };
  });
}

export async function decideSoftwareDomain(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: {
    domainId: string;
    status: "approved" | "denied" | "paused";
    reason: string;
  },
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const domain = await findSoftwareDomainById(transaction, input.domainId);
    if (!domain) {
      throw new SoftwareDirectoryError(
        "domain_not_found",
        "Domaine logiciel introuvable.",
      );
    }
    const decidedAt = nowIso();
    await setSoftwareDomainDecision(transaction, {
      ...input,
      actorId: userId,
      decidedAt,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: `api_intelligence.domain_${input.status}`,
      targetType: "software_domain",
      targetId: input.domainId,
      metadata: { domain: domain.domain, reason: input.reason },
    });
    return { ...domain, approval_status: input.status };
  });
}

export async function createApiProductRecord(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: ApiProductInput,
) {
  const parsed = apiProductInputSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const software = await findSoftwareById(transaction, parsed.softwareId);
    if (!software) {
      throw new SoftwareDirectoryError(
        "software_not_found",
        "Logiciel introuvable.",
      );
    }
    const documentationUrl = normalizeHttpsUrl(parsed.documentationUrl);
    const publisherDomain = new URL(documentationUrl).hostname;
    if (
      !(await findApprovedSoftwareDomain(
        transaction,
        parsed.softwareId,
        publisherDomain,
      ))
    ) {
      throw new SoftwareDirectoryError(
        "domain_not_approved",
        "Le domaine de documentation doit etre approuve.",
      );
    }
    const apiProductId = id("api");
    const createdAt = nowIso();
    await insertApiProduct(transaction, {
      ...parsed,
      id: apiProductId,
      documentationUrl,
      createdAt,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "api_intelligence.api_product_created",
      targetType: "api_product",
      targetId: apiProductId,
      metadata: { softwareId: parsed.softwareId, publisherDomain },
    });
    return { apiProductId };
  });
}

export async function addOfficialApiSource(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: ApiSourceInput,
) {
  const parsed = apiSourceInputSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    if (!(await findSoftwareById(transaction, parsed.softwareId))) {
      throw new SoftwareDirectoryError(
        "software_not_found",
        "Logiciel introuvable.",
      );
    }
    if (parsed.apiProductId) {
      const apiProduct = await findApiProductById(
        transaction,
        parsed.apiProductId,
      );
      if (!apiProduct || apiProduct.software_id !== parsed.softwareId) {
        throw new SoftwareDirectoryError(
          "api_product_not_found",
          "Produit API introuvable.",
        );
      }
    }
    const canonicalUrl = normalizeHttpsUrl(parsed.url);
    const publisherDomain = new URL(canonicalUrl).hostname;
    if (
      !(await findApprovedSoftwareDomain(
        transaction,
        parsed.softwareId,
        publisherDomain,
      ))
    ) {
      throw new SoftwareDirectoryError(
        "domain_not_approved",
        "Le domaine source doit etre approuve avant analyse.",
      );
    }
    const sourceId = id("source");
    await insertApiSource(transaction, {
      ...parsed,
      id: sourceId,
      canonicalUrl,
      publisherDomain,
      sourceClassification: "official",
      createdBy: userId,
      createdAt: nowIso(),
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "api_intelligence.source_added",
      targetType: "api_source",
      targetId: sourceId,
      metadata: { publisherDomain, sourceType: parsed.sourceType },
    });
    return { sourceId, canonicalUrl };
  });
}

export async function getSoftwareDirectory(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertPlatformAdmin(db, userId, tenantId);
  return listSoftwareDirectory(db);
}

export function normalizeDomain(value: string) {
  const candidate = value.trim().toLowerCase().replace(/^https?:\/\//, "");
  const domain = candidate.split("/")[0]!.replace(/\.$/, "");
  if (!/^(?=.{3,253}$)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)) {
    throw new SoftwareDirectoryError(
      "publisher_domain_mismatch",
      "Domaine officiel invalide.",
    );
  }
  return domain;
}

export function normalizeHttpsUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443")
  ) {
    throw new SoftwareDirectoryError(
      "publisher_domain_mismatch",
      "URL HTTPS officielle requise.",
    );
  }
  url.hash = "";
  return url.toString();
}
