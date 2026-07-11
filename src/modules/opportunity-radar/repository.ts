import type { DbClient } from "@/lib/db";
import type { OpportunityRadarAlert } from "@/lib/types";
import type {
  OpportunityRadarAlertSeverity,
  OpportunityRadarAlertStatus,
  OpportunityRadarRuleKey,
} from "@/modules/opportunity-radar/schemas";

export type DetectedOpportunityAlert = {
  ruleKey: OpportunityRadarRuleKey;
  severity: OpportunityRadarAlertSeverity;
  title: string;
  explanation: string;
  entityType: string;
  entityId: string;
  actionLabel: string;
  actionHref: string;
};

type OpportunityRadarAlertRow = {
  id: string;
  tenant_id: string;
  rule_key: OpportunityRadarRuleKey;
  severity: OpportunityRadarAlertSeverity;
  title: string;
  explanation: string;
  entity_type: string;
  entity_id: string;
  action_label: string;
  action_href: string;
  status: OpportunityRadarAlertStatus;
  detected_at: string;
  dismissed_at: string | null;
  resolved_at: string | null;
};

export async function listOpportunityRadarAlerts(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<OpportunityRadarAlertRow>(
    `select *
     from opportunity_radar_alerts
     where tenant_id = $1 and status <> $2
     order by
       case severity when 'critical' then 0 when 'warning' then 1 else 2 end,
       detected_at desc`,
    [tenantId, "resolved"],
  );

  return result.rows.map(mapOpportunityRadarAlert);
}

export async function findOpportunityRadarAlert(
  db: DbClient,
  tenantId: string,
  alertId: string,
) {
  const result = await db.query<OpportunityRadarAlertRow>(
    "select * from opportunity_radar_alerts where tenant_id = $1 and id = $2",
    [tenantId, alertId],
  );

  return result.rows[0] ? mapOpportunityRadarAlert(result.rows[0]) : null;
}

export async function upsertDetectedOpportunityAlert(
  db: DbClient,
  input: DetectedOpportunityAlert & {
    id: string;
    tenantId: string;
    detectedAt: string;
    updatedAt: string;
  },
) {
  await db.query(
    `insert into opportunity_radar_alerts
       (id, tenant_id, rule_key, severity, title, explanation, entity_type, entity_id, action_label, action_href, status, detected_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (tenant_id, rule_key, entity_type, entity_id)
     do update set
       severity = excluded.severity,
       title = excluded.title,
       explanation = excluded.explanation,
       action_label = excluded.action_label,
       action_href = excluded.action_href,
       status = case
         when opportunity_radar_alerts.status = 'dismissed' then 'dismissed'
         else 'active'
       end,
       dismissed_at = case
         when opportunity_radar_alerts.status = 'dismissed' then opportunity_radar_alerts.dismissed_at
         else null
       end,
       resolved_at = null,
       updated_at = excluded.updated_at`,
    [
      input.id,
      input.tenantId,
      input.ruleKey,
      input.severity,
      input.title,
      input.explanation,
      input.entityType,
      input.entityId,
      input.actionLabel,
      input.actionHref,
      "active",
      input.detectedAt,
      input.detectedAt,
      input.updatedAt,
    ],
  );
}

export async function resolveOpportunityRadarAlert(
  db: DbClient,
  tenantId: string,
  alertId: string,
  resolvedAt: string,
) {
  await db.query(
    `update opportunity_radar_alerts
     set status = $1, resolved_at = $2, updated_at = $2
     where tenant_id = $3 and id = $4 and status <> $1`,
    ["resolved", resolvedAt, tenantId, alertId],
  );
}

export async function dismissOpportunityRadarAlertRecord(
  db: DbClient,
  tenantId: string,
  alertId: string,
  dismissedAt: string,
) {
  const result = await db.query<OpportunityRadarAlertRow>(
    `update opportunity_radar_alerts
     set status = $1, dismissed_at = $2, updated_at = $2
     where tenant_id = $3 and id = $4 and status = $5
     returning *`,
    ["dismissed", dismissedAt, tenantId, alertId, "active"],
  );

  return result.rows[0] ? mapOpportunityRadarAlert(result.rows[0]) : null;
}

function mapOpportunityRadarAlert(
  row: OpportunityRadarAlertRow,
): OpportunityRadarAlert {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ruleKey: row.rule_key,
    severity: row.severity,
    title: row.title,
    explanation: row.explanation,
    entityType: row.entity_type,
    entityId: row.entity_id,
    detectedAt: row.detected_at,
    actionLabel: row.action_label,
    actionHref: row.action_href,
    status: row.status,
    dismissedAt: row.dismissed_at ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
  };
}
