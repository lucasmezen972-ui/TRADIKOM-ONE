import type { DbClient } from "@/lib/db";
import type {
  DashboardApiSourceFailure,
  DashboardPendingApproval,
} from "@/lib/types";

type DashboardMetricRow = {
  new_leads: number | string;
  contacts: number | string;
  pending_tasks: number | string;
  form_submissions: number | string;
  overdue_tasks: number | string;
  opportunities_needing_follow_up: number | string;
  workflow_failures: number | string;
  dead_letters: number | string;
  connector_issues: number | string;
  api_source_failures: number | string;
  breaking_api_changes: number | string;
  pending_approvals: number | string;
};

export async function getDashboardMetrics(
  db: DbClient,
  tenantId: string,
  input: {
    now: string;
    dayStartedAt: string;
    dayEndsAt: string;
    canApprove: boolean;
  },
) {
  const result = await db.query<DashboardMetricRow>(
    `select
       (select count(*)::int from leads
        where tenant_id = $1 and created_at >= $2 and created_at < $3) as new_leads,
       (select count(*)::int from contacts
        where tenant_id = $1 and lower(status) not in ('archived', 'merged')) as contacts,
       (select count(*)::int from tasks
        where tenant_id = $1 and status = 'open') as pending_tasks,
       (select count(*)::int from form_submissions
        where tenant_id = $1) as form_submissions,
       (select count(*)::int from tasks
        where tenant_id = $1 and status = 'open' and due_at < $4) as overdue_tasks,
       (select count(*)::int from opportunities
        join pipeline_stages on pipeline_stages.id = opportunities.stage_id
          and pipeline_stages.tenant_id = opportunities.tenant_id
        where opportunities.tenant_id = $1
          and opportunities.next_follow_up_at is not null
          and opportunities.next_follow_up_at < $3
          and lower(pipeline_stages.name) not in ('gagne', 'gagné', 'perdu', 'won', 'lost'))
          as opportunities_needing_follow_up,
       (select count(*)::int from workflow_runs
        where tenant_id = $1 and status = 'failed') as workflow_failures,
       (select count(*)::int from domain_events
        where tenant_id = $1 and status = 'failed') as dead_letters,
       (select count(*)::int from connectors
        where tenant_id = $1 and health in ('warning', 'error')) as connector_issues,
       (select count(*)::int from api_source_recheck_schedules
        where context_tenant_id = $1 and last_status in ('blocked', 'retrying'))
          as api_source_failures,
       (select count(distinct api_change_event_id)::int from api_change_impacts
        where tenant_id = $1 and upgrade_blocked = 1) as breaking_api_changes,
       case when $5 = 1 then
         (select count(*)::int from approvals
          where tenant_id = $1 and status = 'pending')
         +
         (select count(*)::int from connector_approval_requests
          where tenant_id = $1 and status = 'pending')
       else 0 end as pending_approvals`,
    [
      tenantId,
      input.dayStartedAt,
      input.dayEndsAt,
      input.now,
      input.canApprove ? 1 : 0,
    ],
  );
  const row = result.rows[0];

  return {
    newLeads: toCount(row?.new_leads),
    contacts: toCount(row?.contacts),
    pendingTasks: toCount(row?.pending_tasks),
    formSubmissions: toCount(row?.form_submissions),
    overdueTasks: toCount(row?.overdue_tasks),
    opportunitiesNeedingFollowUp: toCount(row?.opportunities_needing_follow_up),
    workflowFailures: toCount(row?.workflow_failures),
    deadLetters: toCount(row?.dead_letters),
    connectorIssues: toCount(row?.connector_issues),
    apiSourceFailures: toCount(row?.api_source_failures),
    breakingApiChanges: toCount(row?.breaking_api_changes),
    pendingApprovals: toCount(row?.pending_approvals),
  };
}

export async function listNewLeadActions(
  db: DbClient,
  tenantId: string,
  dayStartedAt: string,
  dayEndsAt: string,
  limit: number,
) {
  const result = await db.query<{
    id: string;
    contact_id: string;
    name: string;
    created_at: string;
  }>(
    `select leads.id, leads.contact_id, contacts.name, leads.created_at
     from leads
     join contacts on contacts.id = leads.contact_id
       and contacts.tenant_id = leads.tenant_id
     where leads.tenant_id = $1 and leads.created_at >= $2 and leads.created_at < $3
     order by leads.created_at desc
     limit $4`,
    [tenantId, dayStartedAt, dayEndsAt, limit],
  );
  return result.rows.map((row) => ({
    id: `lead:${row.id}`,
    title: row.name,
    explanation: "Nouveau lead à qualifier aujourd'hui.",
    actionLabel: "Ouvrir le contact",
    actionHref: `/contacts/${row.contact_id}`,
    severity: "warning" as const,
  }));
}

export async function listOverdueTaskActions(
  db: DbClient,
  tenantId: string,
  now: string,
  limit: number,
) {
  const result = await db.query<{
    id: string;
    title: string;
    related_type: string;
    related_id: string;
    contact_id: string | null;
  }>(
    `select tasks.id, tasks.title, tasks.related_type, tasks.related_id,
       case
         when tasks.related_type = 'contact' then tasks.related_id
         when tasks.related_type = 'lead' then leads.contact_id
         else null
       end as contact_id
     from tasks
     left join leads on leads.id = tasks.related_id
       and leads.tenant_id = tasks.tenant_id
       and tasks.related_type = 'lead'
     where tasks.tenant_id = $1 and tasks.status = 'open' and tasks.due_at < $2
     order by tasks.due_at asc
     limit $3`,
    [tenantId, now, limit],
  );
  return result.rows.map((row) => ({
    id: `task:${row.id}`,
    title: row.title,
    explanation: "Cette tâche a dépassé son échéance.",
    actionLabel: row.contact_id ? "Ouvrir le contact" : "Voir les contacts",
    actionHref: row.contact_id ? `/contacts/${row.contact_id}` : "/contacts",
    severity: "critical" as const,
  }));
}

export async function listOpportunityFollowUpActions(
  db: DbClient,
  tenantId: string,
  dayEndsAt: string,
  limit: number,
) {
  const result = await db.query<{
    id: string;
    name: string;
    value_cents: number;
    next_follow_up_at: string;
  }>(
    `select opportunities.id, contacts.name, opportunities.value_cents,
       opportunities.next_follow_up_at
     from opportunities
     join contacts on contacts.id = opportunities.contact_id
       and contacts.tenant_id = opportunities.tenant_id
     join pipeline_stages on pipeline_stages.id = opportunities.stage_id
       and pipeline_stages.tenant_id = opportunities.tenant_id
     where opportunities.tenant_id = $1
       and opportunities.next_follow_up_at is not null
       and opportunities.next_follow_up_at < $2
       and lower(pipeline_stages.name) not in ('gagne', 'gagné', 'perdu', 'won', 'lost')
     order by opportunities.next_follow_up_at asc
     limit $3`,
    [tenantId, dayEndsAt, limit],
  );
  return result.rows.map((row) => ({
    id: `opportunity:${row.id}`,
    title: row.name,
    explanation: `Relance attendue sur une opportunité de ${formatEuro(row.value_cents)}.`,
    actionLabel: "Ouvrir l'opportunité",
    actionHref: `/opportunites/${row.id}`,
    severity: "warning" as const,
  }));
}

export async function listApiSourceFailureActions(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const result = await db.query<{
    id: string;
    source_id: string;
    source_type: string;
    last_status: "blocked" | "retrying";
  }>(
    `select api_source_recheck_schedules.id,
       api_source_recheck_schedules.source_id,
       api_sources.source_type,
       api_source_recheck_schedules.last_status
     from api_source_recheck_schedules
     join api_sources on api_sources.id = api_source_recheck_schedules.source_id
     where api_source_recheck_schedules.context_tenant_id = $1
       and api_source_recheck_schedules.last_status in ('blocked', 'retrying')
     order by api_source_recheck_schedules.updated_at desc
     limit $2`,
    [tenantId, limit],
  );
  return result.rows.map((row) => ({
    id: `api-source:${row.id}`,
    title: `Source ${row.source_type}`,
    explanation:
      row.last_status === "blocked"
        ? "La relecture de cette source officielle est bloquée."
        : "La relecture de cette source officielle sera retentée.",
    actionLabel: "Ouvrir Intelligence API",
    actionHref: "/intelligence-api",
    severity:
      row.last_status === "blocked"
        ? ("critical" as const)
        : ("warning" as const),
    status: row.last_status,
  })) satisfies DashboardApiSourceFailure[];
}

export async function listBreakingApiChangeActions(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const result = await db.query<{
    id: string;
    primary_classification: string;
  }>(
    `select api_change_events.id, api_change_events.primary_classification
     from api_change_impacts
     join api_change_events on api_change_events.id = api_change_impacts.api_change_event_id
     where api_change_impacts.tenant_id = $1
       and api_change_impacts.upgrade_blocked = 1
     group by api_change_events.id, api_change_events.primary_classification
     order by max(api_change_impacts.updated_at) desc
     limit $2`,
    [tenantId, limit],
  );
  return result.rows.map((row) => ({
    id: `api-change:${row.id}`,
    title: "Changement API bloquant",
    explanation: `Mise à niveau bloquée : ${safeClassification(row.primary_classification)}.`,
    actionLabel: "Examiner l'impact",
    actionHref: "/intelligence-api",
    severity: "critical" as const,
  }));
}

export async function listPendingApprovalActions(
  db: DbClient,
  tenantId: string,
  canApprove: boolean,
  limit: number,
) {
  if (!canApprove) {
    return [] satisfies DashboardPendingApproval[];
  }
  const result = await db.query<{
    id: string;
    approval_type:
      | "workflow"
      | "connector"
      | "strategic"
      | "marketing"
      | "website_ai";
    created_at: string;
  }>(
    `select id,
       case
         when target_type = 'strategic_recommendation' then 'strategic'
         when target_type = 'marketing_campaign_proposal' then 'marketing'
         when target_type = 'website_ai_proposal' then 'website_ai'
         else 'workflow'
       end as approval_type,
       created_at
     from approvals where tenant_id = $1 and status = 'pending'
     union all
     select id, 'connector' as approval_type, created_at
     from connector_approval_requests where tenant_id = $1 and status = 'pending'
     order by created_at asc
     limit $2`,
    [tenantId, limit],
  );
  return result.rows.map((row) => ({
    id: `approval:${row.approval_type}:${row.id}`,
    title:
      row.approval_type === "workflow"
        ? "Approbation d'automatisation"
        : row.approval_type === "strategic"
          ? "Décision stratégique"
          : row.approval_type === "marketing"
            ? "Validation marketing"
            : row.approval_type === "website_ai"
              ? "Validation de brouillon web"
          : "Approbation de connecteur",
    explanation: "Une décision autorisée est en attente.",
    actionLabel: "Examiner",
    actionHref:
      row.approval_type === "workflow"
        ? "/automatisations"
        : row.approval_type === "strategic"
          ? "/conseiller-strategique"
          : row.approval_type === "marketing"
            ? "/marketing"
            : row.approval_type === "website_ai"
              ? "/mon-site"
          : "/intelligence-api",
    severity: "warning" as const,
    approvalType: row.approval_type,
  }));
}

export async function listOpportunityStageCounts(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<{ stage: string; count: number | string }>(
    `select pipeline_stages.name as stage, count(opportunities.id)::int as count
     from pipeline_stages
     left join opportunities
       on opportunities.stage_id = pipeline_stages.id
      and opportunities.tenant_id = pipeline_stages.tenant_id
     where pipeline_stages.tenant_id = $1
     group by pipeline_stages.name, pipeline_stages.position
     order by pipeline_stages.position asc`,
    [tenantId],
  );

  return result.rows.map((row) => ({
    stage: row.stage,
    count: Number(row.count),
  }));
}

function toCount(value: number | string | undefined) {
  return Number(value ?? 0);
}

function formatEuro(valueCents: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(valueCents / 100);
}

function safeClassification(value: string) {
  const labels: Record<string, string> = {
    breaking: "contrat incompatible",
    security: "sécurité modifiée",
    access_policy: "politique d'accès modifiée",
    deprecation: "dépréciation détectée",
  };
  return labels[value] ?? "contrat à revoir";
}
