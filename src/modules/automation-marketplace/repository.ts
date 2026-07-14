import type { DbClient } from "@/lib/db";
import { toJson } from "@/lib/security";

export type AutomationMarketplaceSourceRow = {
  listing_id: string;
  listing_key: string;
  listing_fingerprint: string;
  listing_version: number | string;
  workflow_id: string;
  workflow_key: string;
  name: string;
  trigger_name: string;
  approval_policy: string;
  definition: string;
  status: string;
};

export type AutomationMarketplacePackageRow = {
  id: string;
  listing_id: string;
  source_workflow_id: string;
  package_key: string;
  title: string;
  summary: string;
  template_snapshot: string;
  required_configuration: string;
  approval_policy: string;
  fingerprint: string;
  record_status: "current" | "superseded";
  visibility: "tenant_private";
  execution_enabled: number;
  version: number | string;
  supersedes_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type AutomationMarketplacePreviewRow = {
  id: string;
  package_id: string;
  package_version: number | string;
  package_fingerprint: string;
  status: "ready";
  installation_mode: "preview_only";
  execution_enabled: number;
  preview_steps: string;
  permission_review: string;
  blockers: string;
  created_at: string;
};

const sourceSelect = `
  select listing.id as listing_id,
         listing.listing_key,
         listing.fingerprint as listing_fingerprint,
         listing.version as listing_version,
         workflow.id as workflow_id,
         workflow.workflow_key,
         workflow.name,
         workflow.trigger_name,
         workflow.approval_policy,
         workflow.definition,
         workflow.status
  from private_marketplace_listings listing
  join workflows workflow
    on workflow.tenant_id = listing.tenant_id
   and workflow.id = listing.workflow_id`;

export async function listAutomationMarketplaceSources(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<AutomationMarketplaceSourceRow>(
    `${sourceSelect}
     where listing.tenant_id = $1
       and listing.record_status = 'current'
       and listing.visibility = 'private'
       and listing.category = 'workflow'
       and listing.source_kind = 'workflow'
       and workflow.status = 'active'
     order by workflow.name asc, workflow.id asc
     limit 100`,
    [tenantId],
  );
  return result.rows;
}

export async function findAutomationMarketplaceSource(
  db: DbClient,
  tenantId: string,
  listingId: string,
) {
  const result = await db.query<AutomationMarketplaceSourceRow>(
    `${sourceSelect}
     where listing.tenant_id = $1 and listing.id = $2
       and listing.record_status = 'current'
       and listing.visibility = 'private'
       and listing.category = 'workflow'
       and listing.source_kind = 'workflow'
       and workflow.status = 'active'`,
    [tenantId, listingId],
  );
  return result.rows[0] ?? null;
}

export async function listCurrentAutomationPackages(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<AutomationMarketplacePackageRow>(
    `select * from automation_marketplace_packages
     where tenant_id = $1 and record_status = 'current'
     order by title asc, id asc limit 100`,
    [tenantId],
  );
  return result.rows;
}

export async function listAutomationPackagePreviews(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<AutomationMarketplacePreviewRow>(
    `select * from automation_marketplace_previews
     where tenant_id = $1 order by created_at desc, id desc limit 100`,
    [tenantId],
  );
  return result.rows;
}

export async function findCurrentAutomationPackageByKey(
  db: DbClient,
  tenantId: string,
  packageKey: string,
) {
  const result = await db.query<AutomationMarketplacePackageRow>(
    `select * from automation_marketplace_packages
     where tenant_id = $1 and package_key = $2 and record_status = 'current'`,
    [tenantId, packageKey],
  );
  return result.rows[0] ?? null;
}

export async function findCurrentAutomationPackage(
  db: DbClient,
  tenantId: string,
  packageId: string,
) {
  const result = await db.query<AutomationMarketplacePackageRow>(
    `select * from automation_marketplace_packages
     where tenant_id = $1 and id = $2 and record_status = 'current'`,
    [tenantId, packageId],
  );
  return result.rows[0] ?? null;
}

export async function getNextAutomationPackageVersion(
  db: DbClient,
  tenantId: string,
  packageKey: string,
) {
  const result = await db.query<{ version: number | string }>(
    `select coalesce(max(version), 0) + 1 as version
     from automation_marketplace_packages
     where tenant_id = $1 and package_key = $2`,
    [tenantId, packageKey],
  );
  return Number(result.rows[0]?.version ?? 1);
}

export async function supersedeAutomationPackage(
  db: DbClient,
  tenantId: string,
  packageId: string,
  now: string,
) {
  const result = await db.query<{ id: string }>(
    `update automation_marketplace_packages
     set record_status = 'superseded', updated_at = $3
     where tenant_id = $1 and id = $2 and record_status = 'current'
     returning id`,
    [tenantId, packageId, now],
  );
  return result.rows[0] ?? null;
}

export async function insertAutomationPackage(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    listingId: string;
    workflowId: string;
    packageKey: string;
    title: string;
    summary: string;
    template: Record<string, unknown>;
    requiredConfiguration: string[];
    approvalPolicy: string;
    fingerprint: string;
    version: number;
    supersedesId?: string;
    createdBy: string;
    now: string;
  },
) {
  await db.query(
    `insert into automation_marketplace_packages (
       id, tenant_id, listing_id, source_workflow_id, package_key, title,
       summary, template_snapshot, required_configuration, approval_policy,
       fingerprint, record_status, visibility, execution_enabled, version,
       supersedes_id, created_by, created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'current',
       'tenant_private', 0, $12, $13, $14, $15, $15
     )`,
    [
      input.id,
      input.tenantId,
      input.listingId,
      input.workflowId,
      input.packageKey,
      input.title,
      input.summary,
      toJson(input.template),
      toJson(input.requiredConfiguration),
      input.approvalPolicy,
      input.fingerprint,
      input.version,
      input.supersedesId ?? null,
      input.createdBy,
      input.now,
    ],
  );
}

export async function findAutomationPackagePreview(
  db: DbClient,
  tenantId: string,
  packageId: string,
  packageVersion: number,
) {
  const result = await db.query<AutomationMarketplacePreviewRow>(
    `select * from automation_marketplace_previews
     where tenant_id = $1 and package_id = $2 and package_version = $3`,
    [tenantId, packageId, packageVersion],
  );
  return result.rows[0] ?? null;
}

export async function insertAutomationPackagePreview(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    packageId: string;
    packageVersion: number;
    packageFingerprint: string;
    steps: string[];
    permissionReview: Record<string, unknown>;
    blockers: string[];
    createdBy: string;
    now: string;
  },
) {
  await db.query(
    `insert into automation_marketplace_previews (
       id, tenant_id, package_id, package_version, package_fingerprint,
       status, installation_mode, execution_enabled, preview_steps,
       permission_review, blockers, created_by, created_at
     ) values ($1, $2, $3, $4, $5, 'ready', 'preview_only', 0, $6, $7, $8, $9, $10)`,
    [
      input.id,
      input.tenantId,
      input.packageId,
      input.packageVersion,
      input.packageFingerprint,
      toJson(input.steps),
      toJson(input.permissionReview),
      toJson(input.blockers),
      input.createdBy,
      input.now,
    ],
  );
}
