import type { DbClient } from "@/lib/db";
import type { SalesAiEvidenceCandidate } from "@/modules/sales-ai/rules";
import type {
  SalesAiPriority,
  SalesAiStatus,
} from "@/modules/sales-ai/schemas";

export type SalesOpportunitySignal = {
  opportunityId: string;
  contactName: string;
  stageId: string;
  stageName: string;
  stagePosition: number;
  valueCents: number;
  nextFollowUpAt: string | null;
  assignedUserId: string | null;
  lastActivityAt: string | null;
  openTaskCount: number;
  overdueTaskCount: number;
};

type SalesOpportunitySignalRow = {
  opportunity_id: string;
  contact_name: string;
  stage_id: string;
  stage_name: string;
  stage_position: number;
  value_cents: number;
  next_follow_up_at: string | null;
  assigned_user_id: string | null;
  last_activity_at: string | null;
  open_task_count: number | string;
  overdue_task_count: number | string;
};

export type SalesAiAssessmentRow = {
  id: string;
  tenant_id: string;
  opportunity_id: string;
  fingerprint: string;
  status: SalesAiStatus;
  score: number;
  closing_estimate: number;
  confidence: number;
  priority: SalesAiPriority;
  title: string;
  rationale: string;
  recommended_action: string;
  risk_summary: string;
  action_label: string;
  action_href: string;
  version: number;
  supersedes_id: string | null;
  generation_version: string;
  generated_by: string;
  created_at: string;
  updated_at: string;
  contact_name: string;
  stage_name: string;
  value_cents: number;
  next_follow_up_at: string | null;
};

export type SalesAiEvidenceRow = {
  id: string;
  tenant_id: string;
  assessment_id: string;
  evidence_type: SalesAiEvidenceCandidate["type"];
  evidence_ref: string;
  label: string;
  observed_value: string;
  captured_at: string;
  created_at: string;
};

export async function listActiveSalesOpportunitySignals(
  db: DbClient,
  tenantId: string,
  now: string,
) {
  const result = await db.query<SalesOpportunitySignalRow>(
    `select opportunities.id as opportunity_id, contacts.name as contact_name,
       pipeline_stages.id as stage_id, pipeline_stages.name as stage_name,
       pipeline_stages.position as stage_position, opportunities.value_cents,
       opportunities.next_follow_up_at, contacts.assigned_user_id,
       (select max(activities.created_at) from activities
        where activities.tenant_id = opportunities.tenant_id
          and ((activities.target_type = 'opportunity' and activities.target_id = opportunities.id)
            or (activities.target_type = 'contact' and activities.target_id = opportunities.contact_id)))
         as last_activity_at,
       (select count(*)::int from tasks
        where tasks.tenant_id = opportunities.tenant_id
          and tasks.status not in ('done', 'cancelled')
          and ((tasks.related_type = 'opportunity' and tasks.related_id = opportunities.id)
            or (tasks.related_type = 'contact' and tasks.related_id = opportunities.contact_id)))
         as open_task_count,
       (select count(*)::int from tasks
        where tasks.tenant_id = opportunities.tenant_id
          and tasks.status not in ('done', 'cancelled')
          and tasks.due_at < $2
          and ((tasks.related_type = 'opportunity' and tasks.related_id = opportunities.id)
            or (tasks.related_type = 'contact' and tasks.related_id = opportunities.contact_id)))
         as overdue_task_count
     from opportunities
     join contacts on contacts.tenant_id = opportunities.tenant_id
       and contacts.id = opportunities.contact_id
     join pipeline_stages on pipeline_stages.tenant_id = opportunities.tenant_id
       and pipeline_stages.id = opportunities.stage_id
     where opportunities.tenant_id = $1 and opportunities.lost_reason is null
       and lower(pipeline_stages.name) not in ('gagne', 'perdu')
     order by opportunities.updated_at desc
     limit 100
     for update of opportunities`,
    [tenantId, now],
  );
  return result.rows.map((row) => ({
    opportunityId: row.opportunity_id,
    contactName: row.contact_name,
    stageId: row.stage_id,
    stageName: row.stage_name,
    stagePosition: Number(row.stage_position),
    valueCents: Number(row.value_cents),
    nextFollowUpAt: row.next_follow_up_at,
    assignedUserId: row.assigned_user_id,
    lastActivityAt: row.last_activity_at,
    openTaskCount: Number(row.open_task_count),
    overdueTaskCount: Number(row.overdue_task_count),
  }));
}

export async function listCurrentSalesAiAssessments(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<SalesAiAssessmentRow>(
    `select sales_ai_assessments.*, contacts.name as contact_name,
       pipeline_stages.name as stage_name, opportunities.value_cents,
       opportunities.next_follow_up_at
     from sales_ai_assessments
     join opportunities on opportunities.tenant_id = sales_ai_assessments.tenant_id
       and opportunities.id = sales_ai_assessments.opportunity_id
     join contacts on contacts.tenant_id = opportunities.tenant_id
       and contacts.id = opportunities.contact_id
     join pipeline_stages on pipeline_stages.tenant_id = opportunities.tenant_id
       and pipeline_stages.id = opportunities.stage_id
     where sales_ai_assessments.tenant_id = $1
       and sales_ai_assessments.status = 'current'
     order by case sales_ai_assessments.priority
       when 'high' then 1 when 'medium' then 2 else 3 end,
       sales_ai_assessments.score asc, sales_ai_assessments.updated_at desc
     limit 100`,
    [tenantId],
  );
  return result.rows;
}

export async function listCurrentSalesAiEvidence(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<SalesAiEvidenceRow>(
    `select sales_ai_evidence.* from sales_ai_evidence
     join sales_ai_assessments
       on sales_ai_assessments.tenant_id = sales_ai_evidence.tenant_id
       and sales_ai_assessments.id = sales_ai_evidence.assessment_id
     where sales_ai_evidence.tenant_id = $1
       and sales_ai_assessments.status = 'current'
     order by sales_ai_evidence.captured_at desc
     limit 600`,
    [tenantId],
  );
  return result.rows;
}

export async function findCurrentSalesAiAssessmentByFingerprint(
  db: DbClient,
  tenantId: string,
  opportunityId: string,
  fingerprint: string,
) {
  const result = await db.query<{ id: string }>(
    `select id from sales_ai_assessments
     where tenant_id = $1 and opportunity_id = $2 and fingerprint = $3
       and status = 'current'
     limit 1`,
    [tenantId, opportunityId, fingerprint],
  );
  return result.rows[0] ?? null;
}

export async function getNextSalesAiAssessmentVersion(
  db: DbClient,
  tenantId: string,
  opportunityId: string,
) {
  const result = await db.query<{ version: number | string }>(
    `select coalesce(max(version), 0) + 1 as version
     from sales_ai_assessments where tenant_id = $1 and opportunity_id = $2`,
    [tenantId, opportunityId],
  );
  return Number(result.rows[0]?.version ?? 1);
}

export async function supersedeCurrentSalesAiAssessment(
  db: DbClient,
  tenantId: string,
  opportunityId: string,
  now: string,
) {
  const result = await db.query<{ id: string }>(
    `update sales_ai_assessments set status = 'superseded', updated_at = $3
     where tenant_id = $1 and opportunity_id = $2 and status = 'current'
     returning id`,
    [tenantId, opportunityId, now],
  );
  return result.rows;
}

export async function insertSalesAiAssessment(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    candidate: Omit<SalesAiAssessmentInsert, "evidence">;
    version: number;
    supersedesId?: string;
    generationVersion: string;
    actorId: string;
    now: string;
  },
) {
  const candidate = input.candidate;
  await db.query(
    `insert into sales_ai_assessments (
       id, tenant_id, opportunity_id, fingerprint, status, score,
       closing_estimate, confidence, priority, title, rationale,
       recommended_action, risk_summary, action_label, action_href, version,
       supersedes_id, generation_version, generated_by, created_at, updated_at
     ) values (
       $1, $2, $3, $4, 'current', $5, $6, $7, $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17, $18, $19, $19
     )`,
    [
      input.id,
      input.tenantId,
      candidate.opportunityId,
      candidate.fingerprint,
      candidate.score,
      candidate.closingEstimate,
      candidate.confidence,
      candidate.priority,
      candidate.title,
      candidate.rationale,
      candidate.recommendedAction,
      candidate.riskSummary,
      candidate.actionLabel,
      candidate.actionHref,
      input.version,
      input.supersedesId ?? null,
      input.generationVersion,
      input.actorId,
      input.now,
    ],
  );
}

export async function insertSalesAiEvidence(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    assessmentId: string;
    evidence: SalesAiEvidenceCandidate;
    now: string;
  },
) {
  await db.query(
    `insert into sales_ai_evidence (
       id, tenant_id, assessment_id, evidence_type, evidence_ref, label,
       observed_value, captured_at, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [
      input.id,
      input.tenantId,
      input.assessmentId,
      input.evidence.type,
      input.evidence.ref,
      input.evidence.label,
      input.evidence.observedValue,
      input.now,
    ],
  );
}

type SalesAiAssessmentInsert = {
  opportunityId: string;
  fingerprint: string;
  score: number;
  closingEstimate: number;
  confidence: number;
  priority: SalesAiPriority;
  title: string;
  rationale: string;
  recommendedAction: string;
  riskSummary: string;
  actionLabel: string;
  actionHref: string;
  evidence: SalesAiEvidenceCandidate[];
};
