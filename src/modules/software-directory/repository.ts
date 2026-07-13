import type { DbClient } from "@/lib/db";
import { safeJson, toJson } from "@/lib/security";

export type SoftwareDirectoryRow = {
  id: string;
  canonical_name: string;
  aliases: string;
  vendor: string;
  official_domain: string;
  country: string | null;
  supported_regions: string;
  languages: string;
  industries: string;
  categories: string;
  official_website: string;
  developer_portal: string | null;
  support_page: string | null;
  partner_program_page: string | null;
  pricing_information_page: string | null;
  verification_status: string;
  confidence_score: number;
  last_verified_at: string | null;
  evidence_count: number;
  created_at: string;
  updated_at: string;
};

export type ApprovedDomainRow = {
  id: string;
  software_id: string;
  domain: string;
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
};

export type ApiSourceRow = {
  id: string;
  software_id: string;
  api_product_id: string | null;
  canonical_url: string;
  source_type: string;
  source_classification: string;
  publisher_domain: string;
  created_by: string;
  created_at: string;
};

export type ApiSnapshotRow = {
  id: string;
  source_id: string;
  retrieved_at: string;
  http_status: number;
  etag: string | null;
  last_modified: string | null;
  content_hash: string;
  parser_version: string;
  robots_decision: string;
  access_policy_decision: string;
  content_type: string;
  content: string;
  safe_metadata: string;
  created_at: string;
};

export type ApiProductRow = {
  id: string;
  software_id: string;
  name: string;
  api_style: string;
  version: string;
  base_url: string | null;
  documentation_url: string;
  authentication_type: string;
  oauth_metadata: string;
  scopes: string;
  webhook_support: number;
  sandbox_support: number;
  partner_access_requirement: number;
  access_level: string;
  deprecation_status: string;
  confidence_score: number;
  last_verified_at: string | null;
};

export async function insertSoftwareDirectoryEntry(
  db: DbClient,
  input: {
    id: string;
    canonicalName: string;
    aliases: string[];
    vendor: string;
    officialDomain: string;
    country?: string;
    supportedRegions: string[];
    languages: string[];
    industries: string[];
    categories: string[];
    officialWebsite: string;
    developerPortal?: string;
    supportPage?: string;
    partnerProgramPage?: string;
    pricingInformationPage?: string;
    createdBy: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into software_directory_entries (
       id, canonical_name, aliases, vendor, official_domain, country,
       supported_regions, languages, industries, categories, official_website,
       developer_portal, support_page, partner_program_page,
       pricing_information_page, verification_status, confidence_score,
       last_verified_at, evidence_count, created_by, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
    [
      input.id,
      input.canonicalName,
      toJson(input.aliases),
      input.vendor,
      input.officialDomain,
      input.country ?? null,
      toJson(input.supportedRegions),
      toJson(input.languages),
      toJson(input.industries),
      toJson(input.categories),
      input.officialWebsite,
      input.developerPortal || null,
      input.supportPage || null,
      input.partnerProgramPage || null,
      input.pricingInformationPage || null,
      "under_review",
      50,
      null,
      0,
      input.createdBy,
      input.createdAt,
      input.createdAt,
    ],
  );
}

export async function findSoftwareById(db: DbClient, softwareId: string) {
  const result = await db.query<SoftwareDirectoryRow>(
    "select * from software_directory_entries where id = $1",
    [softwareId],
  );
  return result.rows[0] ?? null;
}

export async function listSoftwareDirectory(db: DbClient) {
  const result = await db.query<SoftwareDirectoryRow>(
    "select * from software_directory_entries order by canonical_name asc",
  );
  return result.rows.map(mapSoftwareRow);
}

export async function insertSoftwareDomain(
  db: DbClient,
  input: {
    id: string;
    softwareId: string;
    domain: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into software_domains (
       id, software_id, domain, approval_status, decision_reason,
       approved_by, approved_at, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.id,
      input.softwareId,
      input.domain,
      "pending",
      null,
      null,
      null,
      input.createdAt,
      input.createdAt,
    ],
  );
}

export async function setSoftwareDomainDecision(
  db: DbClient,
  input: {
    domainId: string;
    status: "approved" | "denied" | "paused";
    reason: string;
    actorId: string;
    decidedAt: string;
  },
) {
  await db.query(
    `update software_domains
     set approval_status = $1, decision_reason = $2, approved_by = $3,
         approved_at = $4, updated_at = $4
     where id = $5`,
    [input.status, input.reason, input.actorId, input.decidedAt, input.domainId],
  );
}

export async function findSoftwareDomainById(db: DbClient, domainId: string) {
  const result = await db.query<ApprovedDomainRow>(
    "select * from software_domains where id = $1",
    [domainId],
  );
  return result.rows[0] ?? null;
}

export async function findApprovedSoftwareDomain(
  db: DbClient,
  softwareId: string,
  domain: string,
) {
  const result = await db.query<ApprovedDomainRow>(
    `select * from software_domains
     where software_id = $1 and domain = $2 and approval_status = 'approved'`,
    [softwareId, domain],
  );
  return result.rows[0] ?? null;
}

export async function insertApiProduct(
  db: DbClient,
  input: {
    id: string;
    softwareId: string;
    name: string;
    apiStyle: string;
    version: string;
    documentationUrl: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into api_products (
       id, software_id, name, api_style, version, base_url,
       documentation_url, openapi_url, postman_collection_url,
       graphql_schema_url, authentication_type, oauth_metadata, scopes,
       webhook_support, sandbox_support, partner_access_requirement,
       access_level, rate_limit_information, deprecation_status, terms_url,
       confidence_score, last_verified_at, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
    [
      input.id,
      input.softwareId,
      input.name,
      input.apiStyle,
      input.version,
      null,
      input.documentationUrl,
      null,
      null,
      null,
      "unknown",
      toJson({}),
      toJson([]),
      0,
      0,
      0,
      "unknown",
      null,
      "unknown",
      null,
      50,
      null,
      input.createdAt,
      input.createdAt,
    ],
  );
}

export async function findApiProductById(db: DbClient, apiProductId: string) {
  const result = await db.query<ApiProductRow>(
    "select * from api_products where id = $1",
    [apiProductId],
  );
  return result.rows[0] ?? null;
}

export async function updateApiProductFromSpecification(
  db: DbClient,
  input: {
    apiProductId: string;
    sourceUrl: string;
    baseUrl?: string;
    authenticationType: string;
    oauthMetadata: unknown;
    scopes: string[];
    webhookSupport: boolean;
    rateLimitInformation: { fingerprint?: string; locators: string[] };
    confidenceScore: number;
    verifiedAt: string;
  },
) {
  await db.query(
    `update api_products
     set openapi_url = $1, base_url = $2, authentication_type = $3,
         oauth_metadata = $4, scopes = $5, webhook_support = $6,
         rate_limit_information = $7, confidence_score = $8,
         last_verified_at = $9, updated_at = $9
     where id = $10`,
    [
      input.sourceUrl,
      input.baseUrl ?? null,
      input.authenticationType,
      toJson(input.oauthMetadata),
      toJson(input.scopes),
      input.webhookSupport ? 1 : 0,
      toJson(input.rateLimitInformation),
      input.confidenceScore,
      input.verifiedAt,
      input.apiProductId,
    ],
  );
}

export async function updateApiProductFromPostmanCollection(
  db: DbClient,
  input: {
    apiProductId: string;
    sourceUrl: string;
    baseUrl?: string;
    authenticationType: string;
    oauthMetadata: unknown;
    scopes: string[];
    confidenceScore: number;
    verifiedAt: string;
  },
) {
  await db.query(
    `update api_products
     set postman_collection_url = $1,
         base_url = coalesce($2, base_url),
         authentication_type = $3,
         oauth_metadata = $4,
         scopes = $5,
         confidence_score = case
           when confidence_score > $6 then confidence_score else $6
         end,
         last_verified_at = $7,
         updated_at = $7
     where id = $8`,
    [
      input.sourceUrl,
      input.baseUrl ?? null,
      input.authenticationType,
      toJson(input.oauthMetadata),
      toJson(input.scopes),
      input.confidenceScore,
      input.verifiedAt,
      input.apiProductId,
    ],
  );
}

export async function updateApiProductFromGraphQlSchema(
  db: DbClient,
  input: {
    apiProductId: string;
    sourceUrl: string;
    confidenceScore: number;
    verifiedAt: string;
  },
) {
  await db.query(
    `update api_products
     set graphql_schema_url = $1,
         confidence_score = case
           when confidence_score > $2 then confidence_score else $2
         end,
         last_verified_at = $3,
         updated_at = $3
     where id = $4`,
    [
      input.sourceUrl,
      input.confidenceScore,
      input.verifiedAt,
      input.apiProductId,
    ],
  );
}

export async function insertApiSource(
  db: DbClient,
  input: {
    id: string;
    softwareId: string;
    apiProductId?: string;
    canonicalUrl: string;
    sourceType: string;
    sourceClassification: string;
    publisherDomain: string;
    createdBy: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into api_sources (
       id, software_id, api_product_id, canonical_url, source_type,
       source_classification, publisher_domain, created_by, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.id,
      input.softwareId,
      input.apiProductId ?? null,
      input.canonicalUrl,
      input.sourceType,
      input.sourceClassification,
      input.publisherDomain,
      input.createdBy,
      input.createdAt,
    ],
  );
}

export async function findApiSourceById(db: DbClient, sourceId: string) {
  const result = await db.query<ApiSourceRow>(
    "select * from api_sources where id = $1",
    [sourceId],
  );
  return result.rows[0] ?? null;
}

export async function insertApiSourceSnapshot(
  db: DbClient,
  input: {
    id: string;
    sourceId: string;
    retrievedAt: string;
    httpStatus: number;
    etag?: string;
    lastModified?: string;
    contentHash: string;
    parserVersion: string;
    robotsDecision: string;
    accessPolicyDecision: string;
    contentType: string;
    content: string;
    safeMetadata: unknown;
    createdAt: string;
  },
) {
  await db.query(
    `insert into api_source_snapshots (
       id, source_id, retrieved_at, http_status, etag, last_modified,
       content_hash, parser_version, robots_decision, access_policy_decision,
       content_type, content, safe_metadata, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      input.id,
      input.sourceId,
      input.retrievedAt,
      input.httpStatus,
      input.etag ?? null,
      input.lastModified ?? null,
      input.contentHash,
      input.parserVersion,
      input.robotsDecision,
      input.accessPolicyDecision,
      input.contentType,
      input.content,
      toJson(input.safeMetadata),
      input.createdAt,
    ],
  );
  const existing = await findApiSnapshotById(db, input.id);
  if (!existing) throw new Error("Source snapshot persistence failed.");
  return existing;
}

export async function findApiSnapshotById(db: DbClient, snapshotId: string) {
  const result = await db.query<ApiSnapshotRow>(
    "select * from api_source_snapshots where id = $1",
    [snapshotId],
  );
  return result.rows[0] ?? null;
}

export async function findLatestApiSnapshot(db: DbClient, sourceId: string) {
  const result = await db.query<ApiSnapshotRow>(
    `select * from api_source_snapshots
     where source_id = $1
     order by retrieved_at desc, created_at desc
     limit 1`,
    [sourceId],
  );
  return result.rows[0] ?? null;
}

export function mapSoftwareRow(row: SoftwareDirectoryRow) {
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    aliases: safeJson<string[]>(row.aliases, []),
    vendor: row.vendor,
    officialDomain: row.official_domain,
    country: row.country ?? undefined,
    supportedRegions: safeJson<string[]>(row.supported_regions, []),
    languages: safeJson<string[]>(row.languages, []),
    industries: safeJson<string[]>(row.industries, []),
    categories: safeJson<string[]>(row.categories, []),
    officialWebsite: row.official_website,
    developerPortal: row.developer_portal ?? undefined,
    supportPage: row.support_page ?? undefined,
    partnerProgramPage: row.partner_program_page ?? undefined,
    pricingInformationPage: row.pricing_information_page ?? undefined,
    verificationStatus: row.verification_status,
    confidenceScore: row.confidence_score,
    lastVerifiedAt: row.last_verified_at ?? undefined,
    evidenceCount: row.evidence_count,
  };
}
