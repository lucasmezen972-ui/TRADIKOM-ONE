import type { DbClient } from "@/lib/db";

export async function getDashboardMetrics(db: DbClient, tenantId: string) {
  const [leadRows, contactRows, taskRows, submissionRows] = await Promise.all([
    db.query<{ count: number | string }>(
      "select count(*)::int as count from leads where tenant_id = $1",
      [tenantId],
    ),
    db.query<{ count: number | string }>(
      "select count(*)::int as count from contacts where tenant_id = $1",
      [tenantId],
    ),
    db.query<{ count: number | string }>(
      "select count(*)::int as count from tasks where tenant_id = $1 and status = $2",
      [tenantId, "open"],
    ),
    db.query<{ count: number | string }>(
      "select count(*)::int as count from form_submissions where tenant_id = $1",
      [tenantId],
    ),
  ]);

  return {
    newLeads: Number(leadRows.rows[0]?.count ?? 0),
    contacts: Number(contactRows.rows[0]?.count ?? 0),
    pendingTasks: Number(taskRows.rows[0]?.count ?? 0),
    formSubmissions: Number(submissionRows.rows[0]?.count ?? 0),
  };
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
