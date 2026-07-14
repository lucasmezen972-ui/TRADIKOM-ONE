import type { DbClient } from "@/lib/db";

export type SelfImprovementProposalRow = {
  id: string;
  proposal_key: string;
  category: SelfImprovementCategory;
  entity_type: string;
  entity_id: string;
  title: string;
  explanation: string;
  recommendation: string;
  action_label: string;
  action_href: string;
  severity: "critical" | "warning" | "info";
  confidence: number | string;
  fingerprint: string;
  record_status: "current" | "superseded" | "resolved";
  decision_status: "pending" | "accepted" | "dismissed";
  version: number | string;
  supersedes_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SelfImprovementCategory =
  | "workflow_failed"
  | "workflow_unused"
  | "connector_degraded"
  | "connector_unused"
  | "contact_duplicates"
  | "seo_metadata"
  | "website_cta";

export type SelfImprovementEvidenceRow = {
  id: string;
  proposal_id: string;
  proposal_version: number | string;
  evidence_key: string;
  source_type: string;
  source_id: string;
  metric_name: string;
  metric_value: number | string;
  summary: string;
  observed_at: string;
};

export type WorkflowSignalRow = {
  id: string;
  workflow_key: string;
  name: string;
  created_at: string;
  run_count: number | string;
  failed_count: number | string;
};

export type ConnectorSignalRow = {
  id: string;
  connector_key: string;
  status: string;
  health: string;
  last_sync_at: string | null;
  created_at: string;
};

export type WebsitePageSignalRow = {
  id: string;
  website_id: string;
  title: string;
  seo_metadata: string;
};

export type WebsiteHeroSignalRow = {
  id: string;
  website_id: string;
  button_label: string | null;
  button_href: string | null;
};

export async function listWorkflowImprovementSignals(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<WorkflowSignalRow>(
    `select workflows.id, workflows.workflow_key, workflows.name,
       workflows.created_at,
       (select count(*)::int from workflow_runs
        where workflow_runs.tenant_id = workflows.tenant_id
          and workflow_runs.workflow_key = workflows.workflow_key) as run_count,
       (select count(*)::int from workflow_runs
        where workflow_runs.tenant_id = workflows.tenant_id
          and workflow_runs.workflow_key = workflows.workflow_key
          and workflow_runs.status = 'failed') as failed_count
     from workflows
     where workflows.tenant_id = $1 and workflows.status = 'active'
     order by workflows.created_at asc, workflows.id asc
     limit 100`,
    [tenantId],
  );
  return result.rows;
}

export async function listConnectorImprovementSignals(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<ConnectorSignalRow>(
    `select id, connector_key, status, health, last_sync_at, created_at
     from connectors where tenant_id = $1
     order by created_at asc, id asc limit 100`,
    [tenantId],
  );
  return result.rows;
}

export async function countDuplicateContactPairs(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<{ duplicate_count: number | string }>(
    `select count(*)::int as duplicate_count from (
       select left_contact.id
       from contacts left_contact
       join contacts right_contact
         on right_contact.tenant_id = left_contact.tenant_id
        and right_contact.id > left_contact.id
       where left_contact.tenant_id = $1
         and lower(left_contact.status) not in ('archived', 'merged')
         and lower(right_contact.status) not in ('archived', 'merged')
         and (
           lower(trim(left_contact.email)) = lower(trim(right_contact.email))
           or (
             char_length(regexp_replace(left_contact.phone, '[^0-9]', '', 'g')) >= 7
             and regexp_replace(left_contact.phone, '[^0-9]', '', 'g') =
                 regexp_replace(right_contact.phone, '[^0-9]', '', 'g')
           )
         )
       limit 100
     ) candidates`,
    [tenantId],
  );
  return Number(result.rows[0]?.duplicate_count ?? 0);
}

export async function listWebsitePageImprovementSignals(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<WebsitePageSignalRow>(
    `select website_pages.id, website_pages.website_id, website_pages.title,
       website_pages.seo_metadata
     from website_pages
     join websites on websites.id = website_pages.website_id
       and websites.tenant_id = website_pages.tenant_id
     where website_pages.tenant_id = $1
     order by website_pages.created_at asc, website_pages.id asc limit 50`,
    [tenantId],
  );
  return result.rows;
}

export async function listWebsiteHeroImprovementSignals(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<WebsiteHeroSignalRow>(
    `select website_sections.id, website_sections.website_id,
       website_sections.button_label, website_sections.button_href
     from website_sections
     join websites on websites.id = website_sections.website_id
       and websites.tenant_id = website_sections.tenant_id
     where website_sections.tenant_id = $1
       and website_sections.type = 'hero' and website_sections.enabled = 1
     order by website_sections.position asc, website_sections.id asc limit 20`,
    [tenantId],
  );
  return result.rows;
}

export async function listCurrentSelfImprovementProposals(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<SelfImprovementProposalRow>(
    `select * from self_improvement_proposals
     where tenant_id = $1 and record_status = 'current'
     order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end,
       updated_at desc, id asc limit 100`,
    [tenantId],
  );
  return result.rows;
}

export async function listSelfImprovementEvidence(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<SelfImprovementEvidenceRow>(
    `select * from self_improvement_evidence
     where tenant_id = $1 order by observed_at desc, id asc limit 500`,
    [tenantId],
  );
  return result.rows;
}

export async function findCurrentSelfImprovementProposal(
  db: DbClient,
  tenantId: string,
  proposalId: string,
) {
  const result = await db.query<SelfImprovementProposalRow>(
    `select * from self_improvement_proposals
     where tenant_id = $1 and id = $2 and record_status = 'current'`,
    [tenantId, proposalId],
  );
  return result.rows[0] ?? null;
}

export async function getNextSelfImprovementVersion(
  db: DbClient,
  tenantId: string,
  proposalKey: string,
) {
  const result = await db.query<{ version: number | string }>(
    `select coalesce(max(version), 0) + 1 as version
     from self_improvement_proposals where tenant_id = $1 and proposal_key = $2`,
    [tenantId, proposalKey],
  );
  return Number(result.rows[0]?.version ?? 1);
}

export async function closeCurrentSelfImprovementProposal(
  db: DbClient,
  input: {
    tenantId: string;
    proposalId: string;
    status: "superseded" | "resolved";
    now: string;
  },
) {
  const result = await db.query<{ id: string }>(
    `update self_improvement_proposals set record_status = $1, updated_at = $2
     where tenant_id = $3 and id = $4 and record_status = 'current'
     returning id`,
    [input.status, input.now, input.tenantId, input.proposalId],
  );
  return result.rows[0] ?? null;
}

export async function insertSelfImprovementProposal(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    proposalKey: string;
    category: SelfImprovementCategory;
    entityType: string;
    entityId: string;
    title: string;
    explanation: string;
    recommendation: string;
    actionLabel: string;
    actionHref: string;
    severity: "critical" | "warning" | "info";
    confidence: number;
    fingerprint: string;
    version: number;
    supersedesId?: string;
    createdBy: string;
    now: string;
  },
) {
  await db.query(
    `insert into self_improvement_proposals (
       id, tenant_id, proposal_key, category, entity_type, entity_id, title,
       explanation, recommendation, action_label, action_href, severity,
       confidence, fingerprint, record_status, decision_status, version,
       supersedes_id, created_by, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14, 'current', 'pending', $15, $16, $17, $18, $18)`,
    [
      input.id,
      input.tenantId,
      input.proposalKey,
      input.category,
      input.entityType,
      input.entityId,
      input.title,
      input.explanation,
      input.recommendation,
      input.actionLabel,
      input.actionHref,
      input.severity,
      input.confidence,
      input.fingerprint,
      input.version,
      input.supersedesId ?? null,
      input.createdBy,
      input.now,
    ],
  );
}

export async function insertSelfImprovementEvidence(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    proposalId: string;
    proposalVersion: number;
    evidenceKey: string;
    sourceType: string;
    sourceId: string;
    metricName: string;
    metricValue: number;
    summary: string;
    observedAt: string;
  },
) {
  await db.query(
    `insert into self_improvement_evidence (
       id, tenant_id, proposal_id, proposal_version, evidence_key, source_type,
       source_id, metric_name, metric_value, summary, observed_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.id,
      input.tenantId,
      input.proposalId,
      input.proposalVersion,
      input.evidenceKey,
      input.sourceType,
      input.sourceId,
      input.metricName,
      input.metricValue,
      input.summary,
      input.observedAt,
    ],
  );
}

export async function updateSelfImprovementDecisionStatus(
  db: DbClient,
  input: {
    tenantId: string;
    proposalId: string;
    decision: "accepted" | "dismissed";
    now: string;
  },
) {
  const result = await db.query<{ id: string }>(
    `update self_improvement_proposals set decision_status = $1, updated_at = $2
     where tenant_id = $3 and id = $4 and record_status = 'current'
       and decision_status = 'pending' returning id`,
    [input.decision, input.now, input.tenantId, input.proposalId],
  );
  return result.rows[0] ?? null;
}

export async function insertSelfImprovementDecision(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    proposalId: string;
    proposalVersion: number;
    decision: "accepted" | "dismissed";
    reason: string;
    createdBy: string;
    now: string;
  },
) {
  await db.query(
    `insert into self_improvement_decisions (
       id, tenant_id, proposal_id, proposal_version, decision, reason,
       created_by, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.id,
      input.tenantId,
      input.proposalId,
      input.proposalVersion,
      input.decision,
      input.reason,
      input.createdBy,
      input.now,
    ],
  );
}
