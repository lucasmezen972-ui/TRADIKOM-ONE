import type { DbClient } from "@/lib/db";
import { toJson } from "@/lib/security";
import type {
  MarketplaceCategory,
  MarketplaceSourceKind,
} from "@/modules/app-marketplace/schemas";

export type MarketplaceSourceRow = {
  source_kind: MarketplaceSourceKind;
  source_key: string;
  source_id: string;
  source_version: number | string;
  title: string;
  summary: string;
  capabilities: string;
  permissions: string;
  provenance: string;
  source_status: string;
  updated_at: string;
};

export type MarketplaceListingRow = {
  id: string;
  listing_key: string;
  category: MarketplaceCategory;
  source_kind: MarketplaceSourceKind;
  connector_plan_id: string | null;
  workflow_id: string | null;
  ai_employee_profile_id: string | null;
  title: string;
  summary: string;
  fingerprint: string;
  record_status: "current" | "superseded";
  visibility: "private";
  capabilities_snapshot: string;
  permissions_snapshot: string;
  provenance_snapshot: string;
  version: number | string;
  supersedes_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type MarketplaceInstallationPreviewRow = {
  id: string;
  listing_id: string;
  listing_version: number | string;
  listing_fingerprint: string;
  status: "ready";
  installation_mode: "preview_only";
  enabled: number;
  installation_steps: string;
  permission_review: string;
  blockers: string;
  created_by: string;
  created_at: string;
};

export async function listMarketplaceSourceRows(
  db: DbClient,
  tenantId: string,
) {
  const [connectorPlans, workflows, aiEmployees] = await Promise.all([
    db.query<MarketplaceSourceRow>(
      `select 'connector_plan' as source_kind,
              'connector:' || plan.store_entry_id as source_key,
              plan.id as source_id,
              plan.version as source_version,
              proposal.name as title,
              software.canonical_name || ' · plan sandbox validé' as summary,
              plan.capabilities_snapshot as capabilities,
              plan.evidence_summary as permissions,
              plan.evidence_summary as provenance,
              plan.installation_mode as source_status,
              plan.updated_at
       from connector_installation_plans plan
       join connector_proposals proposal
         on proposal.tenant_id = plan.tenant_id
        and proposal.id = plan.connector_proposal_id
       join software_directory_entries software on software.id = proposal.software_id
       where plan.tenant_id = $1
         and plan.record_status = 'current'
         and plan.enabled = 0
         and plan.installation_mode = 'sandbox_only'
       order by proposal.name asc, plan.id asc
       limit 100`,
      [tenantId],
    ),
    db.query<MarketplaceSourceRow>(
      `select 'workflow' as source_kind,
              'workflow:' || workflow_key as source_key,
              id as source_id,
              coalesce(nullif(definition::jsonb ->> 'version', '')::integer, 1) as source_version,
              name as title,
              'Automatisation interne déclenchée par ' || trigger_name as summary,
              definition as capabilities,
              approval_policy as permissions,
              jsonb_build_object(
                'workflowKey', workflow_key,
                'trigger', trigger_name,
                'status', status
              )::text as provenance,
              status as source_status,
              created_at as updated_at
       from workflows
       where tenant_id = $1 and status = 'active'
       order by name asc, id asc
       limit 100`,
      [tenantId],
    ),
    db.query<MarketplaceSourceRow>(
      `select 'ai_employee_profile' as source_kind,
              'ai-employee:' || employee_key as source_key,
              id as source_id,
              version as source_version,
              display_name as title,
              purpose as summary,
              skills as capabilities,
              permissions,
              jsonb_build_object(
                'employeeKey', employee_key,
                'role', role_key,
                'approvalLimits', approval_limits,
                'tools', tools
              )::text as provenance,
              operational_status as source_status,
              updated_at
       from ai_employee_profiles
       where tenant_id = $1 and record_status = 'current'
       order by display_name asc, id asc
       limit 100`,
      [tenantId],
    ),
  ]);
  return [...connectorPlans.rows, ...workflows.rows, ...aiEmployees.rows];
}

export async function listCurrentMarketplaceListings(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<MarketplaceListingRow>(
    `select * from private_marketplace_listings
     where tenant_id = $1 and record_status = 'current'
     order by category asc, title asc, id asc
     limit 300`,
    [tenantId],
  );
  return result.rows;
}

export async function listMarketplaceInstallationPreviews(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<MarketplaceInstallationPreviewRow>(
    `select * from marketplace_installation_previews
     where tenant_id = $1
     order by created_at desc, id desc
     limit 300`,
    [tenantId],
  );
  return result.rows;
}

export async function findCurrentMarketplaceListingByKey(
  db: DbClient,
  tenantId: string,
  listingKey: string,
) {
  const result = await db.query<MarketplaceListingRow>(
    `select * from private_marketplace_listings
     where tenant_id = $1 and listing_key = $2 and record_status = 'current'`,
    [tenantId, listingKey],
  );
  return result.rows[0] ?? null;
}

export async function findCurrentMarketplaceListing(
  db: DbClient,
  tenantId: string,
  listingId: string,
) {
  const result = await db.query<MarketplaceListingRow>(
    `select * from private_marketplace_listings
     where tenant_id = $1 and id = $2 and record_status = 'current'`,
    [tenantId, listingId],
  );
  return result.rows[0] ?? null;
}

export async function getNextMarketplaceListingVersion(
  db: DbClient,
  tenantId: string,
  listingKey: string,
) {
  const result = await db.query<{ version: number | string }>(
    `select coalesce(max(version), 0) + 1 as version
     from private_marketplace_listings
     where tenant_id = $1 and listing_key = $2`,
    [tenantId, listingKey],
  );
  return Number(result.rows[0]?.version ?? 1);
}

export async function supersedeMarketplaceListing(
  db: DbClient,
  tenantId: string,
  listingId: string,
  now: string,
) {
  const result = await db.query<{ id: string }>(
    `update private_marketplace_listings
     set record_status = 'superseded', updated_at = $3
     where tenant_id = $1 and id = $2 and record_status = 'current'
     returning id`,
    [tenantId, listingId, now],
  );
  return result.rows[0] ?? null;
}

export async function insertMarketplaceListing(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    listingKey: string;
    category: MarketplaceCategory;
    sourceKind: MarketplaceSourceKind;
    sourceId: string;
    title: string;
    summary: string;
    fingerprint: string;
    capabilities: unknown[];
    permissions: unknown[];
    provenance: Record<string, unknown>;
    version: number;
    supersedesId?: string;
    createdBy: string;
    now: string;
  },
) {
  const sourceIds = {
    connectorPlanId:
      input.sourceKind === "connector_plan" ? input.sourceId : null,
    workflowId: input.sourceKind === "workflow" ? input.sourceId : null,
    aiEmployeeProfileId:
      input.sourceKind === "ai_employee_profile" ? input.sourceId : null,
  };
  await db.query(
    `insert into private_marketplace_listings (
       id, tenant_id, listing_key, category, source_kind, connector_plan_id,
       workflow_id, ai_employee_profile_id, title, summary, fingerprint,
       record_status, visibility, capabilities_snapshot, permissions_snapshot,
       provenance_snapshot, version, supersedes_id, created_by, created_at,
       updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'current', 'private',
       $12, $13, $14, $15, $16, $17, $18, $18
     )`,
    [
      input.id,
      input.tenantId,
      input.listingKey,
      input.category,
      input.sourceKind,
      sourceIds.connectorPlanId,
      sourceIds.workflowId,
      sourceIds.aiEmployeeProfileId,
      input.title,
      input.summary,
      input.fingerprint,
      toJson(input.capabilities),
      toJson(input.permissions),
      toJson(input.provenance),
      input.version,
      input.supersedesId ?? null,
      input.createdBy,
      input.now,
    ],
  );
}

export async function findMarketplaceInstallationPreview(
  db: DbClient,
  tenantId: string,
  listingId: string,
  listingVersion: number,
) {
  const result = await db.query<MarketplaceInstallationPreviewRow>(
    `select * from marketplace_installation_previews
     where tenant_id = $1 and listing_id = $2 and listing_version = $3`,
    [tenantId, listingId, listingVersion],
  );
  return result.rows[0] ?? null;
}

export async function insertMarketplaceInstallationPreview(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    listingId: string;
    listingVersion: number;
    listingFingerprint: string;
    installationSteps: string[];
    permissionReview: Record<string, unknown>;
    blockers: string[];
    createdBy: string;
    now: string;
  },
) {
  await db.query(
    `insert into marketplace_installation_previews (
       id, tenant_id, listing_id, listing_version, listing_fingerprint,
       status, installation_mode, enabled, installation_steps,
       permission_review, blockers, created_by, created_at
     ) values ($1, $2, $3, $4, $5, 'ready', 'preview_only', 0, $6, $7, $8, $9, $10)`,
    [
      input.id,
      input.tenantId,
      input.listingId,
      input.listingVersion,
      input.listingFingerprint,
      toJson(input.installationSteps),
      toJson(input.permissionReview),
      toJson(input.blockers),
      input.createdBy,
      input.now,
    ],
  );
}
