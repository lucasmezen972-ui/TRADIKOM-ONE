import type { DbClient } from "@/lib/db";
import type { BusinessBrainEntryRow } from "@/modules/business-brain/repository";

export const GOAL_WATCH_SOURCE_REF = "goal-watch:v1";

export type GoalWatchEvaluationAuditRow = {
  safe_metadata: string;
  created_at: string;
};

export async function findActiveGoalWatchEntry(
  db: DbClient,
  tenantId: string,
  goalId: string,
  lock = false,
) {
  const result = await db.query<BusinessBrainEntryRow>(
    `select *
     from business_brain_entries
     where tenant_id = $1
       and entry_key = $2
       and domain = 'objectives'
       and source_ref = $3
       and status = 'active'
     limit 1${lock ? " for update" : ""}`,
    [tenantId, goalId, GOAL_WATCH_SOURCE_REF],
  );
  return result.rows[0] ?? null;
}

export async function listActiveGoalWatchEntries(
  db: DbClient,
  limit: number,
) {
  const result = await db.query<BusinessBrainEntryRow>(
    `select *
     from business_brain_entries
     where domain = 'objectives'
       and source_ref = $1
       and status = 'active'
     order by updated_at asc, id asc
     limit $2`,
    [GOAL_WATCH_SOURCE_REF, limit],
  );
  return result.rows;
}

export async function findLatestGoalWatchEvaluationAudit(
  db: DbClient,
  tenantId: string,
  goalId: string,
) {
  const result = await db.query<GoalWatchEvaluationAuditRow>(
    `select safe_metadata, created_at
     from audit_logs
     where tenant_id = $1
       and target_type = 'goal_watch'
       and target_id = $2
       and action = 'goal_watch.evaluated'
     order by (safe_metadata::jsonb ->> 'observedAt')::timestamptz desc,
              created_at desc, id desc
     limit 1`,
    [tenantId, goalId],
  );
  return result.rows[0] ?? null;
}

export async function findGoalWatchEvaluationAuditsByKey(
  db: DbClient,
  tenantId: string,
  goalId: string,
  evaluationKey: string,
) {
  // Search all history for this key; the limit only detects contradictory
  // duplicate records and does not limit the history searched.
  const result = await db.query<GoalWatchEvaluationAuditRow>(
    `select safe_metadata, created_at
     from audit_logs
     where tenant_id = $1
       and target_type = 'goal_watch'
       and target_id = $2
       and action = 'goal_watch.evaluated'
       and safe_metadata::jsonb ->> 'evaluationKey' = $3
     limit 2`,
    [tenantId, goalId, evaluationKey],
  );
  return result.rows;
}
