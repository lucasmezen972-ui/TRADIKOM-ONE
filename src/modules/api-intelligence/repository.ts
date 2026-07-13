import { createHash } from "node:crypto";
import type { DbClient } from "@/lib/db";
import { safeJson, toJson } from "@/lib/security";
import type {
  ApiContractPreview,
  OpenApiPreview,
  PostmanPreview,
} from "@/modules/api-intelligence/analyzer";

export async function replaceOpenApiImport(
  db: DbClient,
  preview: OpenApiPreview,
  input: { createdAt: string; createdBy: string },
) {
  return replaceApiContractImport(db, preview, input);
}

export async function replacePostmanImport(
  db: DbClient,
  preview: PostmanPreview,
  input: { createdAt: string; createdBy: string },
) {
  return replaceApiContractImport(db, preview, input);
}

async function replaceApiContractImport(
  db: DbClient,
  preview: ApiContractPreview,
  input: { createdAt: string; createdBy: string },
) {
  await db.query(
    `delete from api_claims
     where (subject_type = 'api_product' and subject_id = $1)
        or (subject_type = 'api_schema' and subject_id in (
              select id from api_schemas where api_product_id = $1
            ))
        or (subject_type = 'api_operation' and subject_id in (
              select id from api_operations where api_product_id = $1
            ))`,
    [preview.apiProductId],
  );
  await db.query("delete from api_operations where api_product_id = $1", [
    preview.apiProductId,
  ]);
  await db.query("delete from api_schemas where api_product_id = $1", [
    preview.apiProductId,
  ]);
  const schemaEvidence = new Map<string, string>();
  const schemaClaims = new Map<string, string>();
  const claimIds: string[] = [];

  const productClaimId = stableId(
    "claim_product",
    preview.apiProductId,
    preview.sourceHash,
  );
  const productEvidenceId = stableId(
    "evidence_product",
    preview.apiProductId,
    preview.sourceHash,
  );
  await insertClaimWithEvidence(db, {
    claimId: productClaimId,
    evidenceId: productEvidenceId,
    snapshotId: preview.snapshotId,
    subjectType: "api_product",
    subjectId: preview.apiProductId,
    claimType: "api_metadata",
    claimValue: {
      parserVersion: preview.parserVersion,
      title: preview.title,
      version: preview.version,
      baseUrl: preview.baseUrl,
      authenticationType: preview.authenticationType,
      scopes: preview.scopes,
      webhookSupport: preview.webhookSupport,
      rateLimitFingerprint: preview.rateLimitFingerprint,
      rateLimitLocators: preview.rateLimitLocators,
      ...(preview.parserVersion === "postman-1"
        ? {
            collectionSchema: preview.collectionSchema,
            variables: preview.variables,
            examples: preview.examples,
            scripts: preview.scripts,
            blockedScriptCount: preview.blockedScriptCount,
          }
        : {}),
    },
    locator: "#",
    excerptHash: preview.sourceHash,
    createdAt: input.createdAt,
  });
  claimIds.push(productClaimId);

  for (const schema of preview.schemas) {
    const schemaId = stableId("schema", preview.apiProductId, schema.name);
    await db.query(
      `insert into api_schemas (
         id, api_product_id, source_snapshot_id, schema_name,
         schema_document, created_at
       ) values ($1, $2, $3, $4, $5, $6)`,
      [
        schemaId,
        preview.apiProductId,
        preview.snapshotId,
        schema.name,
        toJson(schema.document),
        input.createdAt,
      ],
    );
    const claimId = stableId("claim_schema", preview.apiProductId, schema.name);
    const evidenceId = stableId(
      "evidence_schema",
      preview.apiProductId,
      schema.name,
    );
    await insertClaimWithEvidence(db, {
      claimId,
      evidenceId,
      snapshotId: preview.snapshotId,
      subjectType: "api_schema",
      subjectId: schemaId,
      claimType: "schema_exists",
      claimValue: { schemaName: schema.name },
      locator: `#/components/schemas/${escapeJsonPointer(schema.name)}`,
      excerptHash: preview.sourceHash,
      createdAt: input.createdAt,
    });
    schemaEvidence.set(schema.name, evidenceId);
    schemaClaims.set(schema.name, claimId);
    claimIds.push(claimId);
  }

  for (const operation of preview.operations) {
    const operationId = stableId(
      "operation",
      preview.apiProductId,
      operation.operationKey,
    );
    await db.query(
      `insert into api_operations (
         id, api_product_id, source_snapshot_id, operation_key, method,
         path, summary, tags, capability, deprecated, request_schema_ref,
         response_schema_ref, security_requirements, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        operationId,
        preview.apiProductId,
        preview.snapshotId,
        operation.operationKey,
        operation.method,
        operation.path,
        operation.summary,
        toJson(operation.tags),
        operation.capability,
        operation.deprecated ? 1 : 0,
        operation.requestSchemaRef ?? null,
        operation.responseSchemaRef ?? null,
        toJson(operation.securityRequirements),
        input.createdAt,
      ],
    );
    const claimId = stableId(
      "claim_operation",
      preview.apiProductId,
      operation.operationKey,
    );
    await insertClaimWithEvidence(db, {
      claimId,
      evidenceId: stableId(
        "evidence_operation",
        preview.apiProductId,
        operation.operationKey,
      ),
      snapshotId: preview.snapshotId,
      subjectType: "api_operation",
      subjectId: operationId,
      claimType: "operation_exists",
      claimValue: {
        operationKey: operation.operationKey,
        method: operation.method,
        path: operation.path,
        capability: operation.capability,
        exampleCount: operation.exampleCount,
      },
      locator:
        operation.locator ??
        `#/paths/${escapeJsonPointer(operation.path)}/${operation.method.toLowerCase()}`,
      excerptHash: preview.sourceHash,
      createdAt: input.createdAt,
    });
    claimIds.push(claimId);
  }

  return { schemaEvidence, schemaClaims, claimIds };
}

export async function listApiProductImportSourceTypes(
  db: DbClient,
  apiProductId: string,
) {
  const result = await db.query<{ source_type: string }>(
    `select distinct api_sources.source_type
     from api_source_snapshots
     join api_sources on api_sources.id = api_source_snapshots.source_id
     where api_source_snapshots.id in (
       select source_snapshot_id from api_operations where api_product_id = $1
       union
       select source_snapshot_id from api_schemas where api_product_id = $1
       union
       select source_snapshot_id from api_claims
       where subject_type = 'api_product' and subject_id = $1
     )
     order by api_sources.source_type asc`,
    [apiProductId],
  );
  return result.rows.map((row) => row.source_type);
}

export async function listApiOperations(db: DbClient, apiProductId: string) {
  const result = await db.query<{
    id: string;
    operation_key: string;
    method: string;
    path: string;
    summary: string;
    tags: string;
    capability: "read" | "write";
    deprecated: number;
    request_schema_ref: string | null;
    response_schema_ref: string | null;
  }>(
    `select * from api_operations
     where api_product_id = $1
       and exists (
         select 1 from api_claims
         where api_claims.subject_type = 'api_operation'
           and api_claims.subject_id = api_operations.id
           and api_claims.approval_status = 'approved'
       )
     order by path asc, method asc`,
    [apiProductId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    operationKey: row.operation_key,
    method: row.method,
    path: row.path,
    summary: row.summary,
    tags: safeJson<string[]>(row.tags, []),
    capability: row.capability,
    deprecated: Boolean(row.deprecated),
    requestSchemaRef: row.request_schema_ref ?? undefined,
    responseSchemaRef: row.response_schema_ref ?? undefined,
  }));
}

export async function listApiSchemas(db: DbClient, apiProductId: string) {
  const result = await db.query<{
    id: string;
    schema_name: string;
    schema_document: string;
  }>(
    "select id, schema_name, schema_document from api_schemas where api_product_id = $1 order by schema_name asc",
    [apiProductId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.schema_name,
    document: safeJson<unknown>(row.schema_document, {}),
  }));
}

export async function findSchemaEvidence(
  db: DbClient,
  apiProductId: string,
  schemaName: string,
) {
  const result = await db.query<{ evidence_id: string }>(
    `select api_evidence.id as evidence_id
     from api_evidence
     join api_claims on api_claims.id = api_evidence.claim_id
     join api_schemas on api_schemas.id = api_claims.subject_id
     where api_schemas.api_product_id = $1
       and api_schemas.schema_name = $2
       and api_claims.approval_status = 'approved'
     limit 1`,
    [apiProductId, schemaName],
  );
  return result.rows[0]?.evidence_id ?? null;
}

export async function listApiClaimsForProduct(
  db: DbClient,
  apiProductId?: string,
) {
  const result = await db.query<{
    id: string;
    api_product_id: string;
    product_name: string;
    subject_type: string;
    claim_type: string;
    claim_value: string;
    approval_status: string;
    locator: string;
    source_url: string;
  }>(
    `select api_claims.id,
            api_products.id as api_product_id,
            api_products.name as product_name,
            api_claims.subject_type,
            api_claims.claim_type,
            api_claims.claim_value,
            api_claims.approval_status,
            api_evidence.locator,
            api_sources.canonical_url as source_url
     from api_claims
     join api_evidence on api_evidence.claim_id = api_claims.id
     join api_source_snapshots
       on api_source_snapshots.id = api_claims.source_snapshot_id
     join api_sources on api_sources.id = api_source_snapshots.source_id
     join api_products on api_products.id = api_sources.api_product_id
     where ($1::text is null or api_products.id = $1::text)
     order by api_products.name asc, api_claims.subject_type asc,
              api_evidence.locator asc`,
    [apiProductId ?? null],
  );
  return result.rows.map((row) => ({
    id: row.id,
    apiProductId: row.api_product_id,
    productName: row.product_name,
    subjectType: row.subject_type,
    claimType: row.claim_type,
    value: safeJson<Record<string, unknown>>(row.claim_value, {}),
    status: row.approval_status,
    locator: row.locator,
    sourceUrl: row.source_url,
  }));
}

export async function findApiClaimById(db: DbClient, claimId: string) {
  const result = await db.query<{
    id: string;
    subject_type: string;
    subject_id: string;
    approval_status: string;
  }>("select * from api_claims where id = $1", [claimId]);
  return result.rows[0] ?? null;
}

export async function setApiClaimDecision(
  db: DbClient,
  input: {
    decisionId: string;
    claimId: string;
    status: "approved" | "rejected";
    reason: string;
    decidedBy: string;
    decidedAt: string;
  },
) {
  await db.query(
    "update api_claims set approval_status = $1 where id = $2",
    [input.status, input.claimId],
  );
  await db.query(
    `insert into api_verification_decisions (
       id, claim_id, decision, reason, decided_by, created_at
     ) values ($1, $2, $3, $4, $5, $6)`,
    [
      input.decisionId,
      input.claimId,
      input.status,
      input.reason,
      input.decidedBy,
      input.decidedAt,
    ],
  );
}

export async function hasApprovedApiProductClaim(
  db: DbClient,
  apiProductId: string,
) {
  const result = await db.query<{ id: string }>(
    `select id from api_claims
     where subject_type = 'api_product' and subject_id = $1
       and approval_status = 'approved'
     limit 1`,
    [apiProductId],
  );
  return Boolean(result.rows[0]);
}

async function insertClaimWithEvidence(
  db: DbClient,
  input: {
    claimId: string;
    evidenceId: string;
    snapshotId: string;
    subjectType: string;
    subjectId: string;
    claimType: string;
    claimValue: unknown;
    locator: string;
    excerptHash: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into api_claims (
       id, source_snapshot_id, subject_type, subject_id, claim_type,
       claim_value, confidence, approval_status, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.claimId,
      input.snapshotId,
      input.subjectType,
      input.subjectId,
      input.claimType,
      toJson(input.claimValue),
      "high",
      "under_review",
      input.createdAt,
    ],
  );
  await db.query(
    `insert into api_evidence (
       id, claim_id, source_snapshot_id, locator, excerpt_hash, created_at
     ) values ($1, $2, $3, $4, $5, $6)`,
    [
      input.evidenceId,
      input.claimId,
      input.snapshotId,
      input.locator,
      input.excerptHash,
      input.createdAt,
    ],
  );
}

function stableId(prefix: string, apiProductId: string, value: string) {
  const readable = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 36);
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `${prefix}_${apiProductId}_${readable}_${digest}`;
}

function escapeJsonPointer(value: string) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
