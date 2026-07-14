import type { DbClient } from "@/lib/db";
import { safeJson, toJson } from "@/lib/security";
import type {
  BusinessProfile,
  Website,
  WebsiteSection,
  WebsiteTemplateKey,
} from "@/lib/types";

type WebsiteRow = {
  id: string;
  tenant_id: string;
  name: string;
  template_key: WebsiteTemplateKey;
  theme: string;
  status: "draft" | "published";
  current_version_id: string | null;
  current_published_version_id: string | null;
  current_draft_version_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type WebsiteSectionRow = {
  id: string;
  tenant_id: string;
  website_id: string;
  type: WebsiteSection["type"];
  position: number;
  enabled: number;
  title: string;
  body: string;
  image_url: string | null;
  button_label: string | null;
  button_href: string | null;
  data: string;
};

export type WebsiteVersionSummary = {
  id: string;
  source: string;
  approval_state: string;
  created_at: string;
};

export async function findBusinessProfile(db: DbClient, tenantId: string) {
  const result = await db.query<{ data: string }>(
    "select data from business_profiles where tenant_id = $1",
    [tenantId],
  );

  return result.rows[0]?.data
    ? safeJson<BusinessProfile>(result.rows[0].data, null as never)
    : null;
}

export async function findWebsiteId(db: DbClient, tenantId: string) {
  const existing = await db.query<{ id: string }>(
    "select id from websites where tenant_id = $1 limit 1",
    [tenantId],
  );

  return existing.rows[0]?.id ?? null;
}

export async function insertWebsite(db: DbClient, website: Website) {
  await db.query(
    `insert into websites (id, tenant_id, name, template_key, theme, status, current_version_id, published_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      website.id,
      website.tenantId,
      website.name,
      website.templateKey,
      toJson(website.theme),
      website.status,
      null,
      website.publishedAt ?? null,
      website.createdAt,
      website.updatedAt,
    ],
  );
}

export async function updateWebsiteFromDraft(
  db: DbClient,
  input: {
    tenantId: string;
    websiteId: string;
    website: Website;
    updatedAt: string;
  },
) {
  await db.query(
    "update websites set name = $1, template_key = $2, theme = $3, status = $4, updated_at = $5 where tenant_id = $6 and id = $7",
    [
      input.website.name,
      input.website.templateKey,
      toJson(input.website.theme),
      "draft",
      input.updatedAt,
      input.tenantId,
      input.websiteId,
    ],
  );
}

export async function insertWebsitePage(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    websiteId: string;
    slug: string;
    title: string;
    seoMetadata: string;
    createdAt: string;
  },
) {
  await db.query(
    "insert into website_pages (id, tenant_id, website_id, slug, title, seo_metadata, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [
      input.id,
      input.tenantId,
      input.websiteId,
      input.slug,
      input.title,
      input.seoMetadata,
      input.createdAt,
    ],
  );
}

export async function insertWebsiteForm(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    websiteId: string;
    name: string;
    createdAt: string;
  },
) {
  await db.query(
    "insert into forms (id, tenant_id, website_id, name, created_at) values ($1, $2, $3, $4, $5)",
    [input.id, input.tenantId, input.websiteId, input.name, input.createdAt],
  );
}

export async function insertWebsiteSection(
  db: DbClient,
  section: WebsiteSection,
) {
  await db.query(
    `insert into website_sections (id, tenant_id, website_id, type, position, enabled, title, body, image_url, button_label, button_href, data)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      section.id,
      section.tenantId,
      section.websiteId,
      section.type,
      section.position,
      section.enabled ? 1 : 0,
      section.title,
      section.body,
      section.imageUrl ?? null,
      section.buttonLabel ?? null,
      section.buttonHref ?? null,
      toJson(section.data),
    ],
  );
}

export async function deleteWebsiteSections(
  db: DbClient,
  tenantId: string,
  websiteId: string,
) {
  await db.query("delete from website_sections where tenant_id = $1 and website_id = $2", [
    tenantId,
    websiteId,
  ]);
}

export async function findWebsite(db: DbClient, tenantId: string) {
  const result = await db.query<WebsiteRow>(
    "select * from websites where tenant_id = $1 order by created_at desc limit 1",
    [tenantId],
  );
  const row = result.rows[0];
  return row ? mapWebsite(row) : null;
}

export async function findWebsiteSections(
  db: DbClient,
  tenantId: string,
  websiteId: string,
) {
  const result = await db.query<WebsiteSectionRow>(
    "select * from website_sections where tenant_id = $1 and website_id = $2 order by position asc",
    [tenantId, websiteId],
  );

  return result.rows.map(mapSection);
}

export async function listWebsiteVersions(
  db: DbClient,
  tenantId: string,
  websiteId: string,
) {
  const versions = await db.query<WebsiteVersionSummary>(
    "select id, source, approval_state, created_at from website_versions where tenant_id = $1 and website_id = $2 order by created_at desc limit 8",
    [tenantId, websiteId],
  );

  return versions.rows;
}

export async function findSectionWebsite(
  db: DbClient,
  tenantId: string,
  sectionId: string,
) {
  const row = await db.query<{ website_id: string }>(
    "select website_id from website_sections where tenant_id = $1 and id = $2",
    [tenantId, sectionId],
  );

  return row.rows[0]?.website_id ?? null;
}

export async function updateWebsiteSectionContent(
  db: DbClient,
  input: {
    tenantId: string;
    sectionId: string;
    title: string;
    body: string;
    imageUrl?: string;
    buttonLabel?: string;
    buttonHref?: string;
    enabled: boolean;
  },
) {
  await db.query(
    `update website_sections
     set title = $1, body = $2, image_url = $3, button_label = $4, button_href = $5, enabled = $6
     where tenant_id = $7 and id = $8`,
    [
      input.title,
      input.body,
      input.imageUrl || null,
      input.buttonLabel || null,
      input.buttonHref || null,
      input.enabled ? 1 : 0,
      input.tenantId,
      input.sectionId,
    ],
  );
}

export async function markWebsiteDraft(
  db: DbClient,
  input: {
    tenantId: string;
    websiteId: string;
    updatedAt: string;
  },
) {
  await db.query(
    "update websites set status = $1, updated_at = $2 where tenant_id = $3 and id = $4",
    ["draft", input.updatedAt, input.tenantId, input.websiteId],
  );
}

export async function listSectionPositions(db: DbClient, tenantId: string) {
  const sections = await db.query<{
    id: string;
    website_id: string;
    position: number;
  }>(
    "select id, website_id, position from website_sections where tenant_id = $1 order by position asc",
    [tenantId],
  );

  return sections.rows;
}

export async function updateSectionPosition(
  db: DbClient,
  tenantId: string,
  sectionId: string,
  position: number,
) {
  await db.query("update website_sections set position = $1 where tenant_id = $2 and id = $3", [
    position,
    tenantId,
    sectionId,
  ]);
}

export async function insertWebsiteVersion(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    websiteId: string;
    snapshot: string;
    source: string;
    versionType: "draft" | "published";
    createdAt: string;
  },
) {
  await db.query(
    "insert into website_versions (id, tenant_id, website_id, snapshot, approval_state, source, version_type, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [
      input.id,
      input.tenantId,
      input.websiteId,
      input.snapshot,
      "approved_for_preview",
      input.source,
      input.versionType,
      input.createdAt,
    ],
  );
}

export async function updateWebsiteVersionPointers(
  db: DbClient,
  input: {
    tenantId: string;
    websiteId: string;
    versionId: string;
    versionType: "draft" | "published";
  },
) {
  await db.query(
    "update websites set current_version_id = $1, current_draft_version_id = case when $2 = 'draft' then $1 else current_draft_version_id end where tenant_id = $3 and id = $4",
    [input.versionId, input.versionType, input.tenantId, input.websiteId],
  );
}

export async function publishWebsiteVersion(
  db: DbClient,
  input: {
    tenantId: string;
    websiteId: string;
    versionId: string;
    publishedAt: string;
  },
) {
  await db.query(
    "update websites set status = $1, published_at = $2, current_version_id = $3, current_published_version_id = $4, updated_at = $5 where tenant_id = $6 and id = $7",
    [
      "published",
      input.publishedAt,
      input.versionId,
      input.versionId,
      input.publishedAt,
      input.tenantId,
      input.websiteId,
    ],
  );
}

export async function insertWebsitePublication(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    websiteId: string;
    versionId: string;
    localUrl: string;
    publishedAt: string;
  },
) {
  await db.query(
    "insert into website_publications (id, tenant_id, website_id, version_id, local_url, published_at) values ($1, $2, $3, $4, $5, $6)",
    [
      input.id,
      input.tenantId,
      input.websiteId,
      input.versionId,
      input.localUrl,
      input.publishedAt,
    ],
  );
}

export async function findWebsiteVersionSnapshot(
  db: DbClient,
  tenantId: string,
  versionId: string,
) {
  const result = await db.query<{ website_id: string; snapshot: string }>(
    "select website_id, snapshot from website_versions where tenant_id = $1 and id = $2",
    [tenantId, versionId],
  );

  return result.rows[0] ?? null;
}

export async function findLatestPublishedSnapshot(
  db: DbClient,
  tenantId: string,
) {
  const publication = await db.query<{ snapshot: string }>(
    `select website_versions.snapshot
     from website_publications
     join website_versions on website_versions.id = website_publications.version_id
     where website_publications.tenant_id = $1
     order by website_publications.published_at desc
     limit 1`,
    [tenantId],
  );

  return publication.rows[0]?.snapshot ?? null;
}

function mapWebsite(row: WebsiteRow): Website {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    templateKey: row.template_key,
    status: row.status,
    theme: safeJson(row.theme, {
      primary: "#08111f",
      accent: "#19c6b7",
      background: "#fffaf1",
      text: "#111827",
      radius: "8px",
    }),
    currentVersionId: row.current_version_id ?? undefined,
    currentPublishedVersionId: row.current_published_version_id ?? undefined,
    currentDraftVersionId: row.current_draft_version_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at ?? undefined,
  };
}

function mapSection(row: WebsiteSectionRow): WebsiteSection {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    websiteId: row.website_id,
    type: row.type,
    position: Number(row.position),
    enabled: Boolean(row.enabled),
    title: row.title,
    body: row.body,
    imageUrl: row.image_url ?? undefined,
    buttonLabel: row.button_label ?? undefined,
    buttonHref: row.button_href ?? undefined,
    data: safeJson(row.data, {}),
  };
}
