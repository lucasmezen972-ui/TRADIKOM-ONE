import type { DbClient } from "@/lib/db";
import type { BusinessBrainEntryRow } from "@/modules/business-brain/repository";

export const GOAL_WATCH_SOURCE_REF = "goal-watch:v1";

export type GoalWatchControlRow = {
  entry_id: string; tenant_id: string; goal_id: string; thread_id: string;
  state: "active" | "paused" | "stopped"; version: number;
  consented_by: string; consented_at: string; updated_by: string;
  updated_at: string; next_due_at: string | Date;
};

export async function findGoalWatchControl(db: DbClient, tenantId: string, goalId: string, lock = false) {
  const result = await db.query<GoalWatchControlRow>(
    `select * from goal_watch_controls where tenant_id = $1 and goal_id = $2${lock ? " for update" : ""}`,
    [tenantId, goalId],
  );
  return result.rows[0] ?? null;
}

export async function insertGoalWatchControl(db: DbClient, input: {
  entryId: string; tenantId: string; goalId: string; threadId: string; actorId: string; now: string;
}) {
  await db.query(`insert into goal_watch_controls
    (entry_id, tenant_id, goal_id, thread_id, state, version, consented_by, consented_at, updated_by, updated_at, next_due_at)
    values ($1, $2, $3, $4, 'active', 1, $5, $6, $5, $6, '1970-01-01T00:00:00Z')`,
  [input.entryId, input.tenantId, input.goalId, input.threadId, input.actorId, input.now]);
}

export async function listGoalWatchEntriesForThread(db: DbClient, tenantId: string, threadId: string) {
  return (await db.query<BusinessBrainEntryRow>(`select * from business_brain_entries
    where tenant_id = $1 and domain = 'objectives' and source_ref = $3 and status = 'active'
      and app_goal_watch_thread_id(details) = $2 order by created_at desc, id desc limit 100`,
  [tenantId, threadId, GOAL_WATCH_SOURCE_REF])).rows;
}

export async function listDueGoalWatchEntries(db: DbClient, limit: number, now: string) {
  return (await db.query<BusinessBrainEntryRow>(`select entry.* from business_brain_entries entry
    join goal_watch_controls control on control.tenant_id = entry.tenant_id and control.entry_id = entry.id
    join (select tenant_id, goal_id, row_number() over (partition by tenant_id order by next_due_at, goal_id) as tenant_rank
      from goal_watch_controls where state = 'active' and next_due_at <= $2::timestamptz) due
      on due.tenant_id = control.tenant_id and due.goal_id = control.goal_id
    where entry.domain = 'objectives' and entry.source_ref = $3 and entry.status = 'active'
      and control.state = 'active' and control.next_due_at <= $2::timestamptz
    order by due.tenant_rank, control.next_due_at, control.tenant_id, control.goal_id limit $1`,
  [limit, now, GOAL_WATCH_SOURCE_REF])).rows;
}

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
  afterId = "",
) {
  const result = await db.query<BusinessBrainEntryRow>(
    `select *
     from business_brain_entries
     where domain = 'objectives'
       and source_ref = $1
       and status = 'active'
       and id > $3
     order by id asc
     limit $2`,
    [GOAL_WATCH_SOURCE_REF, limit, afterId],
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
